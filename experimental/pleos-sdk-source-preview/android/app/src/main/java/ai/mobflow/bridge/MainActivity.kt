package ai.mobflow.bridge

import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.WaypointIndex
import ai.pleos.playground.navi.data.CurrentLocationInfo
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.RequestWaypointInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.RouteStartInfo
import ai.pleos.playground.navi.data.RouteWithWaypointsRequest
import ai.pleos.playground.navi.data.WaypointInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Development bridge only. No real-device use, arbitrary URL, external messaging, or automatic route retries. */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    companion object {
        private val journalLock = Any()
        private var generation = 0L
    }
    private val lock get() = journalLock
    private var owner = 0L
    private val terminal = setOf("readback-matched", "failed", "uncertain", "expired", "cancelled")
    private lateinit var status: TextView
    private lateinit var connectButton: Button
    private lateinit var consumeButton: Button
    private lateinit var retryButton: Button
    private val preferences by lazy { getSharedPreferences("sdk-attempt-journal", MODE_PRIVATE) }
    private var helper: NaviHelper? = null
    private var ready = false
    private var destroyed = false
    private var job: JSONObject? = null
    private var sequence = 0
    private var outbox = JSONArray()
    private var readbackStarted = false
    private var routeAttempted = false
    private var stopping = false
    private var draining = false
    private var claimedOnce = false

    private fun onMain(action: () -> Unit) { main.post { if (!destroyed && synchronized(lock) { owner == generation }) action() } }
    private fun show(message: String) = onMain { status.text = message }
    private fun coords(latitude: Double, longitude: Double): JSONObject {
        require(latitude.isFinite() && longitude.isFinite() && latitude in -90.0..90.0 && longitude in -180.0..180.0)
        return JSONObject().put("latitude", latitude).put("longitude", longitude)
    }
    private fun readback(action: () -> Unit) {
        try { action() }
        catch (e: Exception) { emit("uncertain", JSONObject().put("code", "MALFORMED_SDK_READBACK")) }
    }

    private val listener = object : NaviHelperEventListener {
        override fun onRouteStarted(routeStartInfo: RouteStartInfo) = onMain { if (routeAttempted) emit("route-started") }
        override fun onRoutingCompleted() = onMain {
            if (job == null || stopping || !routeAttempted) return@onMain
            emit("routing-completed")
            readbackStarted = true
            try {
                helper?.getDestinationInfo()
                helper?.getWaypointInfo()
                helper?.getCurrentLocationInfo()
            } catch (e: Exception) { emit("error", JSONObject().put("code", e.javaClass.simpleName)) }
        }
        override fun onDestinationInfo(destinationInfo: DestinationInfo) = onMain {
            if (readbackStarted) readback { emit("destination", coords(destinationInfo.latitude, destinationInfo.longitude)) }
        }
        override fun onWayPointInfo(waypointInfoList: List<WaypointInfo>) = onMain {
            if (readbackStarted) readback {
                require(waypointInfoList.size <= 2)
                val points = JSONArray()
                // Preserve SDK order. Never sort or truncate unrecognized results into a false match.
                waypointInfoList.forEach { points.put(coords(it.latitude, it.longitude)) }
                emit("waypoints", points)
            }
        }
        override fun onCurrentLocationInfo(currentLocationInfo: CurrentLocationInfo) = onMain {
            if (readbackStarted) readback { emit("location", coords(currentLocationInfo.latitude, currentLocationInfo.longitude)) }
        }
        override fun onError(errorCode: NaviErrorCode) = onMain {
            if (routeAttempted) emit("error", JSONObject().put("code", errorCode.toString().take(120)))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        synchronized(lock) { generation += 1; owner = generation }
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(36, 36, 36, 36) }
        root.addView(TextView(this).apply { text = "MOBFLOW · Pleos emulator bridge"; textSize = 26f })
        root.addView(TextView(this).apply { text = "NaviHelper 3.0.5 · simulated runtime only\nNo boarding, handover, real GPS, or vehicle-control claims.\nUse adb reverse tcp:3000 tcp:3000. Keep this app open."; textSize = 18f })
        status = TextView(this).apply { text = "Disconnected. No SDK request has been issued."; textSize = 19f }
        root.addView(status)
        connectButton = Button(this).apply { text = "1. Connect to Pleos NaviService"; setOnClickListener { connect() } }; root.addView(connectButton)
        consumeButton = Button(this).apply { text = "2. Consume ONE approved fixture job"; isEnabled = false; setOnClickListener { consume() } }; root.addView(consumeButton)
        retryButton = Button(this).apply { text = "Retry event upload only (never route call)"; setOnClickListener { drain() } }; root.addView(retryButton)
        setContentView(ScrollView(this).apply { addView(root) })
        if (!isEmulator()) {
            status.text = "BLOCKED: this build is for an Android emulator, not a real vehicle or phone."
            connectButton.isEnabled = false; consumeButton.isEnabled = false; retryButton.isEnabled = false
            return
        }
        // A process restart cannot establish whether a previously attempted Binder call executed.
        val saved = preferences.getString("journal", null)
        if (saved != null) {
            try {
                val journal = JSONObject(saved)
                job = journal.getJSONObject("job"); sequence = journal.getInt("sequence")
                outbox = journal.getJSONArray("outbox"); claimedOnce = true
                stopping = journal.optBoolean("stopping", false)
                if (!stopping) emit("uncertain", JSONObject().put("code", "ANDROID_PROCESS_RESTART_NO_REISSUE")) else drain()
                status.text = "Recovering event journal. Previous route call will NOT be repeated."
            } catch (e: Exception) {
                claimedOnce = true; connectButton.isEnabled = false
                status.text = "Journal cannot be read. Refusing to consume another job. Inspect/reset the local test environment manually."
            }
        }
    }

    private fun isEmulator(): Boolean = Build.HARDWARE in setOf("ranchu", "goldfish") &&
        (Build.FINGERPRINT.contains("generic", true) || Build.PRODUCT.contains("sdk", true) || Build.MODEL.contains("emulator", true))

    private fun connect() {
        if (helper != null || !isEmulator() || claimedOnce) return
        connectButton.isEnabled = false
        show("Connecting. Initialization return alone is not connection success.")
        try {
            val instance = NaviHelper(applicationContext); helper = instance
            instance.initialize(
                onConnected = { onMain {
                    try {
                        instance.addListener(listener); ready = true; consumeButton.isEnabled = true
                        status.text = "NaviService connection callback observed. No route has been requested."
                    } catch (e: Exception) { status.text = "Listener registration failed: ${e.javaClass.simpleName}" }
                } },
                onFailed = { throwable -> onMain { ready = false; status.text = "NaviService failed: ${throwable.javaClass.simpleName}. No route issued." } }
            )
        } catch (e: Exception) { show("SDK connection failed: ${e.javaClass.simpleName}") }
    }

    private fun consume() {
        if (!ready || job != null || claimedOnce || !isEmulator()) return
        consumeButton.isEnabled = false; claimedOnce = true
        io.execute {
            try {
                val response = post("/api/pleos/claim", JSONObject().put("clientId", "mobflow-pleos-emulator").put("runtime", "android-emulator"))
                if (response.isNull("job")) { onMain { claimedOnce = false; consumeButton.isEnabled = true; status.text = "No queued job. Approve and enqueue one in the MOBFLOW web page." }; return@execute }
                val received = response.getJSONObject("job")
                synchronized(lock) {
                    if (owner != generation) return@execute
                    job = received; sequence = 0; outbox = JSONArray(); persist()
                }
                onMain { issueOnce(received) }
            } catch (e: Exception) {
                // An uncertain claim response is NOT retried: server may already have marked it claimed.
                show("Claim failed or response uncertain: ${e.javaClass.simpleName}. Check web status. No automatic retry.")
            }
        }
    }

    private fun issueOnce(received: JSONObject) {
        try {
            check(ready && isEmulator())
            check(received.getString("mode") == "emulator-only")
            check(System.currentTimeMillis() < received.getLong("expiresAt"))
            val route = received.getJSONObject("route")
            val destination = route.getJSONObject("destination")
            val waypoints = route.getJSONArray("waypoints")
            check(waypoints.length() <= 2)
            fun checkPoint(p: JSONObject) { check(p.getDouble("latitude").isFinite() && p.getDouble("latitude") in -90.0..90.0); check(p.getDouble("longitude").isFinite() && p.getDouble("longitude") in -180.0..180.0) }
            checkPoint(destination)
            val sdkDestination = RouteInfo(
                latitude = destination.getDouble("latitude"), longitude = destination.getDouble("longitude"),
                poiName = destination.getString("poiName"), poiId = destination.getString("poiId"),
                poiSubId = destination.getString("poiSubId"), address = destination.getString("address")
            )
            val sdkWaypoints = (0 until waypoints.length()).map { index ->
                val p = waypoints.getJSONObject(index); checkPoint(p)
                RequestWaypointInfo(latitude = p.getDouble("latitude"), longitude = p.getDouble("longitude"),
                    poiName = p.getString("poiName"), poiId = p.getString("poiId"), poiSubId = p.getString("poiSubId"),
                    address = p.getString("address"), waypointIndex = if (index == 0) WaypointIndex.FIRST else WaypointIndex.SECOND)
            }
            // Journal the attempt BEFORE calling Binder. A crash afterward must not trigger a second route call.
            synchronized(lock) {
                check(owner == generation && !stopping && job?.optString("id") == received.getString("id")) { "Attempt no longer active" }
                check(emit("sdk-requested")) { "Attempt journal not accepted" }
                routeAttempted = true
                if (sdkWaypoints.isEmpty()) helper!!.requestRoute(sdkDestination)
                else helper!!.requestRouteWithWaypoints(RouteWithWaypointsRequest(destination = sdkDestination, waypoints = sdkWaypoints))
            }
            show("SDK call attempted. Waiting for real NaviHelper callbacks and matching read-back. Not route application proof.")
            main.postDelayed({ if (!destroyed && job != null && !stopping) emit("uncertain", JSONObject().put("code", "CALLBACK_TIMEOUT_NO_REISSUE")) }, 90_000)
        } catch (e: Exception) { emit("error", JSONObject().put("code", e.javaClass.simpleName)) }
    }

    private fun emit(type: String, payload: Any = JSONObject()): Boolean {
        synchronized(lock) {
            val current = job ?: return false
            if (stopping || owner != generation) return false
            sequence += 1
            outbox.put(JSONObject().put("jobId", current.getString("id")).put("event", JSONObject()
                .put("attemptId", current.getString("attemptId")).put("sequence", sequence).put("type", type).put("payload", payload)))
            if (type == "error" || type == "uncertain") stopping = true
            persist()
        }
        drain()
        return true
    }

    private fun persist() {
        check(owner == generation) { "Journal owner superseded" }
        val current = job ?: return
        val journal = JSONObject().put("job", current).put("sequence", sequence).put("outbox", outbox).put("stopping", stopping)
        check(preferences.edit().putString("journal", journal.toString()).commit()) { "Journal write failed; no safe retry" }
    }

    private fun drain() {
        synchronized(lock) { if (owner != generation || draining || outbox.length() == 0) return; draining = true }
        io.execute {
            var uploadFailed = false
            try {
                while (true) {
                    val item = synchronized(lock) { if (owner != generation || outbox.length() == 0) null else outbox.getJSONObject(0) } ?: break
                    val result = post("/api/pleos/jobs/${item.getString("jobId")}/events", item.getJSONObject("event"))
                    val remote = result.getJSONObject("job")
                    var completed = false
                    synchronized(lock) {
                        if (owner != generation) return@execute
                        outbox.remove(0)
                        if (remote.getString("status") in terminal) {
                            stopping = true; outbox = JSONArray()
                            check(preferences.edit().remove("journal").commit())
                            job = null; completed = true
                            show("Result: ${remote.getString("status")}. ${remote.optString("message")}\nNo real-vehicle or child-safety evidence. Restart app for another separately approved test.")
                        } else persist()
                    }
                    if (completed) break
                }
            } catch (e: Exception) { uploadFailed = true; show("Event upload pending: ${e.javaClass.simpleName}. Retry uploads only. Route call will not repeat.") }
            finally {
                val more = synchronized(lock) { draining = false; !uploadFailed && outbox.length() > 0 && !destroyed && owner == generation }
                if (more) drain()
            }
        }
    }

    private fun post(path: String, body: JSONObject): JSONObject {
        val connection = URL("http://127.0.0.1:3000$path").openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.requestMethod = "POST"; connection.connectTimeout = 4000; connection.readTimeout = 4000
        connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
        try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val statusCode = connection.responseCode
            val stream = if (statusCode in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            check(statusCode in 200..299) { "HTTP $statusCode" }
            return JSONObject(text)
        } finally { connection.disconnect() }
    }

    override fun onDestroy() {
        if (job != null && !stopping) emit("uncertain", JSONObject().put("code", "ACTIVITY_CLOSED_NO_REISSUE"))
        destroyed = true; main.removeCallbacksAndMessages(null)
        runCatching { helper?.removeListener(listener); helper?.release() }
        helper = null; ready = false
        io.shutdown()
        super.onDestroy()
    }
}
