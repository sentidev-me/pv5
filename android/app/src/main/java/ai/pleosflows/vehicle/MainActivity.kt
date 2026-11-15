package ai.pleosflows.vehicle

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.widget.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

/** Local contest prototype: real native UI, explicit emulator transport, no production login. */
// Synchronous journal commits are intentional: never send before durable local recording.
@SuppressLint("ApplySharedPref")
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val prefs by lazy { getSharedPreferences("pleosflows-vehicle-v1", MODE_PRIVATE) }
    private val mint = Color.rgb(108,224,182)
    private val muted = Color.rgb(166,185,202)
    // AAOS may supply these APIs through a named shared library or the boot
    // Car APEX (Pleos API 34). Never infer availability from a manifest label.
    private val carApisAvailable by lazy {
        try {
            listOf("android.car.Car", "android.car.VehicleGear", "android.car.VehiclePropertyIds",
                "android.car.hardware.property.CarPropertyManager",
                "android.car.drivingstate.CarUxRestrictionsManager").forEach {
                Class.forName(it, false, classLoader)
            }
            true
        } catch (_: ClassNotFoundException) { false }
        catch (_: LinkageError) { false }
    }
    @Volatile private var active = false
    @Volatile private var destroyed = false
    @Volatile private var generation = 0
    @Volatile private var state = SafetyState()
    private var source: VehicleStateSource? = null
    private var assignment: JSONObject? = null
    private var response: JSONObject? = null
    private var runId = ""
    private var sessionId = ""
    private var sequence = 0L
    private var busy = false
    private var pending: JSONObject? = null
    private var retryAt = 0L
    private var failures = 0
    private var networkAt = 0L
    private var message = "서버 연결을 확인하고 있습니다"
    private var dialog: AlertDialog? = null
    private lateinit var status: TextView
    private lateinit var mode: TextView
    private lateinit var taskTitle: TextView
    private lateinit var taskDetail: TextView
    private lateinit var taskState: TextView
    private lateinit var stateDetail: TextView
    private lateinit var network: TextView
    private lateinit var next: Button
    private lateinit var create: Button
    private lateinit var pendingText: TextView
    private var nextAction = ""
    private var recoverableAssignmentError = false
    // Debug safety boundary, not hardware attestation or production identity.
    private val runtimeAllowed get() = !BuildConfig.LOCAL_EMULATOR_ONLY || Build.HARDWARE in setOf("ranchu", "goldfish")
    private val ticker = object : Runnable {
        override fun run() {
            if (!active) return
            if (BuildConfig.DEMO_MODE) state = state.copy(sampledElapsed = SystemClock.elapsedRealtime())
            render()
            sync()
            main.postDelayed(this, 1500)
        }
    }
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Float, color: Int = Color.WHITE, bold: Boolean = false) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(5), 0, dp(5))
    }
    private fun card() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(24),dp(20),dp(24),dp(20))
        background = GradientDrawable().apply { setColor(Color.rgb(26,43,59)); cornerRadius=dp(20).toFloat() }
    }
    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text=label; textSize=21f; isAllCaps=false; minHeight=dp(64); setTextColor(Color.rgb(16,29,44))
        backgroundTintList=android.content.res.ColorStateList.valueOf(mint)
        setOnClickListener { action() }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        runId = prefs.getString("runId", "") ?: ""
        pending = try { prefs.getString("pending", null)?.let { raw -> JSONObject(raw).also { saved ->
            check(Regex("^/api/native/(fixture|runs/[A-Za-z0-9_-]+/commands)$").matches(saved.getString("path"))); val body=saved.getJSONObject("body");check(body.getString("idempotencyKey").length in 8..120)
        } } } catch (_: Exception) {
            message="저장된 요청을 읽을 수 없습니다. 앱 데이터를 확인하세요."; JSONObject().put("blocked",true)
        }
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(dp(28),dp(18),dp(28),dp(20));setBackgroundColor(Color.rgb(16,29,44)) }
        val header=LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL }
        header.addView(text("↳  PleosFlows",28f,Color.WHITE,true),LinearLayout.LayoutParams(0,dp(56),1f))
        header.addView(text("차량의 움직임을 업무의 흐름으로",16f,muted))
        root.addView(header)
        mode=text(if(BuildConfig.DEMO_MODE) "SIMULATION  ·  개발자 입력 / 차량 센서 사용 안 함" else "PLEOS / AAOS  ·  실제 차량 API 경로 / 공식 PLEOS 에뮬레이터 시험",14f,mint)
        root.addView(mode)
        status=text("차량 연결 확인 필요",21f,mint,true);root.addView(status)
        val columns=LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL;setPadding(0,dp(14),0,dp(10)) }
        val left=card();val right=card()
        columns.addView(left,LinearLayout.LayoutParams(0,LinearLayout.LayoutParams.MATCH_PARENT,1.5f).apply { marginEnd=dp(16) })
        columns.addView(right,LinearLayout.LayoutParams(0,LinearLayout.LayoutParams.MATCH_PARENT,1f))
        left.addView(text("나에게 배정된 업무",15f,muted))
        taskTitle=text("연결 준비 중",30f,Color.WHITE,true);left.addView(taskTitle)
        taskDetail=text("차량 101 · 업무 서버 대기",18f,muted);left.addView(taskDetail)
        taskState=text("배정  →  확인  →  출발  →  도착  →  인계",17f,mint);left.addView(taskState)
        left.addView(Space(this),LinearLayout.LayoutParams(1,0,1f))
        next=button("정차 후 확인",::confirmAction);left.addView(next,LinearLayout.LayoutParams(-1,dp(68)))
        create=button("에뮬레이터 데모 업무 만들기",::createFixture);left.addView(create,LinearLayout.LayoutParams(-1,dp(68)))
        pendingText=text("",14f,muted);left.addView(pendingText)
        right.addView(text("안전 상태",15f,muted))
        stateDetail=text("속도 · 기어 · OS 제한\n모두 확인 후 조작 허용",21f,Color.WHITE,true);right.addView(stateDetail)
        right.addView(Space(this),LinearLayout.LayoutParams(1,dp(16)))
        right.addView(text("현재 범위",15f,muted))
        right.addView(text("정차 중 배정 확인과 업무 완료\n이동 중 조작 잠금\n앱을 열어둔 동안만 상태 연결",17f,Color.WHITE))
        right.addView(text("실제 고객 발송 · 위치 · 차량 제어 없음\n생산 인증 / 실차 호환성 미검증",14f,muted))
        root.addView(columns,LinearLayout.LayoutParams(-1,0,1f))
        network=text("로컬 개발 서버 · adb reverse 연결 필요",14f,muted);root.addView(network)
        if(BuildConfig.DEMO_MODE) {
            val controls=LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL }
            listOf("정차 P","주행 D","OS 제한","신호 끊김").forEachIndexed { i,label ->
                controls.addView(button(label) {
                    state=when(i) {
                        0->SafetyState(true,0.0,"P",false,SystemClock.elapsedRealtime(),"개발자 정차 모의")
                        1->SafetyState(true,12.0,"D",true,SystemClock.elapsedRealtime(),"개발자 주행 모의")
                        2->SafetyState(true,0.0,"P",true,SystemClock.elapsedRealtime(),"개발자 UX 제한 모의")
                        else->SafetyState(detail="개발자 연결 해제 모의")
                    };render()
                },LinearLayout.LayoutParams(0,dp(56),1f).apply { marginEnd=dp(5) })
            }
            root.addView(text("외부 시험 입력 — DEMO APK에만 포함",12f,muted));root.addView(controls)
        }
        setContentView(root)
        if(!BuildConfig.DEMO_MODE && carApisAvailable) source=VehicleStateSource(this) { state=it;render() }
        render()
    }
    override fun onStart() {
        super.onStart();active=true;generation++;sessionId=UUID.randomUUID().toString();sequence=0
        if(!runtimeAllowed) {state=SafetyState(detail="실차 실행 차단 · 에뮬레이터 검증용 빌드");message="이 APK는 공식 PLEOS 에뮬레이터 시험 전용입니다. 실차용 인증·배포 구성이 필요합니다.";render();return}
        if(!BuildConfig.DEMO_MODE) {
            if(!carApisAvailable) { state=SafetyState(detail="AAOS 차량 API 사용 불가 · 잠금 유지");render() }
            else if(checkSelfPermission("android.car.permission.CAR_SPEED")!=PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf("android.car.permission.CAR_SPEED"),44)
            else source?.start()
        }
        main.post(ticker)
    }
    override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,grantResults:IntArray) {
        super.onRequestPermissionsResult(requestCode,permissions,grantResults)
        if(requestCode==44 && active) {
            if(grantResults.firstOrNull()==PackageManager.PERMISSION_GRANTED) source?.start()
            else {state=SafetyState(detail="차량 속도 읽기 권한이 없어 잠겼습니다");render()}
        }
    }
    override fun onStop() {
        active=false;generation++;main.removeCallbacks(ticker);dialog?.dismiss();dialog=null
        source?.stop();state=SafetyState(detail="앱 비활성 · 잠금")
        if(runId.isNotEmpty()) { val body=stateBody();io.execute { try { request("POST","/api/native/state",body) } catch (_:Exception){} } }
        super.onStop()
    }
    override fun onDestroy() { destroyed=true;source?.close();io.shutdown();super.onDestroy() }
    private fun safe() = runtimeAllowed && active && state.permitsInteraction(SystemClock.elapsedRealtime())
    private fun serverSafe() = response?.optJSONObject("vehicleState")?.optBoolean("safe",false)==true && SystemClock.elapsedRealtime()-networkAt<=5000
    private fun render() {
        if(!::status.isInitialized || destroyed) return
        val allowed=safe()
        if(!allowed){dialog?.dismiss();dialog=null}
        status.text=if(runtimeAllowed)state.reason(SystemClock.elapsedRealtime()) else "실차 실행 차단 · 에뮬레이터 검증용 APK";status.setTextColor(if(allowed)mint else Color.rgb(255,206,122))
        stateDetail.text=if(!state.connected) state.detail else "${state.speedMps?.let { String.format(java.util.Locale.ROOT,"%.1f",kotlin.math.abs(it)*3.6) } ?: "—"} km/h    ${state.gear}\nOS 제한: ${when(state.uxRestricted){true->"활성";false->"없음";null->"확인 필요"}}"
        val a=assignment
        val stateName=when(a?.optString("state")){"assigned"->"배정됨";"ready"->"출발 준비";"departed"->"이동 업무 진행";"approaching"->"도착 예정";"arrived"->"도착 확인 · 인계 대기";"completed"->"업무 완료";"revoked"->"배정 철회";else->"배정 대기"}
        taskTitle.text=if(!allowed && a!=null) "주행·상태 확인 중\n정차 후 계속하세요" else a?.optString("title","배정된 업무") ?: "배정된 업무가 없습니다"
        taskDetail.text=if(!allowed && a!=null) "업무는 유지됩니다. 차량 안전 상태 확인 후 다시 보여드립니다." else if(a==null) "에뮬레이터 시험용 가상 업무만 생성합니다." else "차량 101 · ${a.optString("tripId")}\n${a.optString("destination","가상 목적지 · 위치 추적 없음")}\n${a.optString("customerLabel","가상 고객 · 외부 발송 없음")}"
        taskState.text=stateName
        val actions=response?.optJSONArray("allowedActions")
        nextAction=if(actions!=null && actions.length()>0)actions.optString(0) else ""
        next.text=when(nextAction){"accept"->"배정 확인";"depart"->"출발 전 업무 시작";"arrive"->"정차 후 도착 확인";"complete"->"인계 확인 후 업무 완료";else->if(a?.optString("state")=="completed")"완료 기록됨" else "정차·서버 확인 후 계속"}
        next.visibility=if(a==null)View.GONE else View.VISIBLE
        next.isEnabled=allowed && serverSafe() && nextAction.isNotEmpty() && pending==null && !busy
        next.alpha=if(next.isEnabled)1f else .45f
        create.visibility=if(a==null && runId.isEmpty() || a?.optBoolean("expired")==true || a?.optString("state") in listOf("completed","revoked") || recoverableAssignmentError)View.VISIBLE else View.GONE
        create.text=if(recoverableAssignmentError)"별도 가상 업무로 다시 연결" else "에뮬레이터 데모 업무 만들기"
        create.isEnabled=allowed && pending==null && !busy && (networkAt>0 || recoverableAssignmentError)
        create.alpha=if(create.isEnabled)1f else .45f
        pendingText.text=if(pending?.optBoolean("blocked",false)==true)"요청 기록 손상 · 수동 복구 필요 · 전송하지 않습니다" else if(pending!=null)"저장된 요청 확인 중 · 같은 요청만 재전송합니다" else "도착은 완료가 아닙니다. 인계는 별도로 확인합니다."
        network.text=message
    }
    private fun stateBody():JSONObject {
        val valid=state.sampledElapsed>0 && SystemClock.elapsedRealtime()-state.sampledElapsed in 0..3500
        return JSONObject().put("runId",runId).put("clientId","pleosflows-android").put("sessionId",sessionId)
            .put("sequence",++sequence).put("source",if(BuildConfig.DEMO_MODE)"debug-fixture" else "aaos")
            .put("connected",state.connected && valid).put("speedMps",if(valid && state.speedMps?.isFinite()==true)state.speedMps else JSONObject.NULL)
            .put("gear",if(valid)state.gear else "unknown").put("uxRestricted",if(valid)state.uxRestricted ?: JSONObject.NULL else JSONObject.NULL)
            .put("observedAt",System.currentTimeMillis()-if(valid && state.connected)SystemClock.elapsedRealtime()-state.sampledElapsed else 0)
    }
    private fun sync() {
        if(busy || !active || !runtimeAllowed) return
        busy=true
        val owner=generation
        val terminal=assignment?.optBoolean("expired")==true || assignment?.optString("state") in listOf("completed","revoked")
        val creatingFixture=pending?.optString("path")=="/api/native/fixture"
        val body=if(runId.isNotEmpty() && !terminal && !creatingFixture)stateBody() else null
        val currentRun=runId
        val queued=pending?.takeIf { !it.optBoolean("blocked",false) && SystemClock.elapsedRealtime()>=retryAt }
        io.execute {
            var commandAttempted=false
            var committed:JSONObject?=null
            var durableAck=false
            var resetSession=false
            try {
                if(body!=null) {
                    try { request("POST","/api/native/state",body) }
                    catch(e:ApiFailure) {
                        when(e.code) {
                            "SESSION_START_REQUIRED","RETIRED_SESSION" -> resetSession=true
                            "RUN_CLOSED" -> { }
                            else -> throw e
                        }
                    }
                }
                if(queued!=null && !resetSession && active && owner==generation && state.permitsInteraction(SystemClock.elapsedRealtime())) {
                    commandAttempted=true
                    // Final foreground/safety check immediately before a possibly new server command.
                    check(active && owner==generation && state.permitsInteraction(SystemClock.elapsedRealtime()))
                    committed=request("POST",queued.getString("path"),queued.getJSONObject("body"))
                    // Success is persisted before the independent refresh: a failed GET cannot undo ACK.
                    val acknowledgedRun=committed.optJSONObject("assignment")?.optString("runId","") ?: ""
                    val ack=prefs.edit().remove("pending")
                    if(acknowledgedRun.isNotEmpty())ack.putString("runId",acknowledgedRun)
                    check(ack.commit()) { "Acknowledgment persistence failed" };durableAck=true
                }
                val effectiveRun=committed?.optJSONObject("assignment")?.optString("runId","")?.takeIf { it.isNotEmpty() } ?: currentRun
                val query="/api/native/assignment?vehicleId=vehicle-101"+if(effectiveRun.isNotEmpty())"&runId=$effectiveRun" else ""
                var fresh=request("GET",query,null)
                // Discover only a new local assignment after the old one is terminal.
                // Never switch away from an active/pending driver command.
                if(queued==null && fresh.optJSONObject("assignment")?.optString("state") in listOf("completed","revoked")) {
                    val candidate=request("GET","/api/native/assignment?vehicleId=vehicle-101",null)
                    if(candidate.optJSONObject("assignment")!=null)fresh=candidate
                }
                val success=committed
                main.post {
                    if(destroyed)return@post
                    if(success!=null) {pending=null;failures=0;success.optJSONObject("assignment")?.optString("runId","")?.takeIf{it.isNotEmpty()}?.let{runId=it}}
                    if(active && owner==generation) {
                        if(resetSession){sessionId=UUID.randomUUID().toString();sequence=0}
                        success?.let {applyResponse(it)};applyResponse(fresh)
                        recoverableAssignmentError=false;networkAt=SystemClock.elapsedRealtime();message="로컬 서버 연결됨 · 인증 없는 에뮬레이터 시험 전용 · 외부 발송 없음"
                    }
                    busy=false;render()
                }
            } catch(e:Exception) {
                val success=if(durableAck)committed else null
                val definitive=commandAttempted && committed==null && e is ApiFailure && e.status in 400..499
                if(definitive)prefs.edit().remove("pending").commit()
                main.post {
                    if(destroyed)return@post
                    if(success!=null || definitive)pending=null
                    success?.optJSONObject("assignment")?.optString("runId","")?.takeIf{it.isNotEmpty()}?.let{runId=it}
                    if(active && owner==generation) {
                        success?.let {applyResponse(it)}
                        failures++;retryAt=SystemClock.elapsedRealtime()+minOf(30000L,1500L*(1L shl minOf(failures,4)))
                        recoverableAssignmentError=e is ApiFailure && e.code in listOf("RUN_NOT_FOUND","NATIVE_BINDING_CONFLICT","ASSIGNMENT_AMBIGUOUS")
                        message=if(e is ApiFailure)"서버 확인 필요 · ${e.code} · 업무를 자동 완료하지 않습니다" else "연결 끊김 · 요청을 보존했습니다. 연결 후 같은 요청만 확인합니다."
                        networkAt=0
                    }
                    busy=false;render()
                }
            }
        }
    }
    private fun applyResponse(value:JSONObject) {
        if(value.has("assignment")) {
            response=value;assignment=value.optJSONObject("assignment")
            val id=assignment?.optString("runId","") ?: ""
            if(id.isNotEmpty()){if(id!=runId){sessionId=UUID.randomUUID().toString();sequence=0};runId=id;prefs.edit().putString("runId",id).commit()}
        }
    }
    private fun createFixture() {
        if(!safe() || pending!=null || busy)return
        val send = {
            if(safe() && pending==null && !busy)queue("/api/native/fixture",JSONObject().put("vehicleId","vehicle-101").put("source",if(BuildConfig.DEMO_MODE)"debug-fixture" else "aaos").put("idempotencyKey",UUID.randomUUID().toString()))
        }
        if(recoverableAssignmentError) {
            dialog=AlertDialog.Builder(this).setTitle("별도 가상 업무를 만들까요?")
                .setMessage("이 앱의 신호 출처에 맞는 시험 업무를 새로 만듭니다. 기존 업무는 자동 완료·철회하거나 다른 출처로 바꾸지 않습니다.")
                .setNegativeButton("취소",null).setPositiveButton("새 시험 업무 만들기") { _,_ -> send() }.create()
            dialog?.show()
        } else send()
    }
    private fun confirmAction() {
        if(!safe() || !serverSafe() || pending!=null || nextAction.isEmpty())return
        val action=nextAction;val version=assignment?.optInt("version",-1) ?: -1
        dialog=AlertDialog.Builder(this)
            .setTitle(if(action=="complete")"인계가 실제로 끝났나요?" else next.text)
            .setMessage(if(action=="complete")"차량의 도착만으로 완료되지 않습니다. 이 시험에서는 가상 업무의 인계를 확인합니다. 실제 고객 안내는 발송하지 않습니다." else "정차·P단·OS 허용 상태를 서버에서 다시 확인합니다. 고객 안내는 로컬 기록만 생성합니다.")
            .setNegativeButton("취소",null)
            .setPositiveButton("확인") { _,_ ->
                if(safe() && serverSafe() && pending==null) {
                    val body=JSONObject().put("clientId","pleosflows-android").put("sessionId",sessionId).put("expectedVersion",version)
                        .put("idempotencyKey",UUID.randomUUID().toString()).put("action",action)
                    if(action=="complete")body.put("completionConfirmed",true)
                    queue("/api/native/runs/$runId/commands",body)
                }
            }.create()
        dialog?.show()
    }
    private fun queue(path:String,body:JSONObject) {
        val record=JSONObject().put("path",path).put("body",body)
        if(!prefs.edit().putString("pending",record.toString()).commit()) {message="요청 저장 실패 · 전송하지 않았습니다";render();return}
        pending=record;retryAt=0;render();sync()
    }
    private class ApiFailure(val status:Int,val code:String):Exception(code)
    private fun request(method:String,path:String,body:JSONObject?):JSONObject {
        check(path.startsWith("/api/native/"))
        val c=URL("http://127.0.0.1:3000$path").openConnection() as HttpURLConnection
        try {
            c.requestMethod=method;c.connectTimeout=2500;c.readTimeout=3500;c.instanceFollowRedirects=false
            c.setRequestProperty("Accept","application/json")
            if(body!=null){c.doOutput=true;c.setRequestProperty("Content-Type","application/json");c.outputStream.use {it.write(body.toString().toByteArray(Charsets.UTF_8))}}
            val code=c.responseCode
            val raw=(if(code in 200..299)c.inputStream else c.errorStream)?.bufferedReader()?.use {it.readText()} ?: "{}"
            check(raw.length<=250000)
            val result=JSONObject(raw)
            if(code !in 200..299)throw ApiFailure(code,result.optJSONObject("error")?.optString("code","HTTP_$code") ?: "HTTP_$code")
            return result
        } finally {c.disconnect()}
    }
}
