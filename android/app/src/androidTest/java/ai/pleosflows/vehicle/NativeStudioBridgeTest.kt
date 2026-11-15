package ai.pleosflows.vehicle
import android.content.Intent
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.URL
@RunWith(AndroidJUnit4::class)
class NativeStudioBridgeTest {
 @Test fun approvedBrowserRunOnRealAaos() {
 val i=InstrumentationRegistry.getInstrumentation();val c=i.targetContext;val d=UiDevice.getInstance(i)
 val out=File(c.filesDir,"studio-proof").apply{mkdirs()}
 fun get(path:String)=JSONObject(URL("http://127.0.0.1:3000$path").readText())
 fun state(s:String){assertTrue(d.wait(Until.hasObject(By.text(s)),15000));SystemClock.sleep(1800)}
 fun capture(n:String){assertTrue(d.takeScreenshot(File(out,"$n.png")))}
 fun confirm(label:String){val b=d.wait(Until.findObject(By.text(label).enabled(true)),15000);assertNotNull(b);b!!.click();SystemClock.sleep(1200);val yes=d.wait(Until.findObject(By.text("확인")),5000);assertNotNull(yes);yes!!.click()}
 assertFalse(BuildConfig.DEMO_MODE)
 c.startActivity(Intent(c,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
 state("정차 · P단 · 화면 조작 허용");state("배정됨")
 val initial=get("/api/native/assignment?vehicleId=vehicle-101");val a=initial.getJSONObject("assignment");val runId=a.getString("runId");val origin=a.getJSONObject("studioOrigin")
 assertEquals("simulated",origin.getString("externalInput"));assertEquals("deterministic-mock",origin.getString("agent"));assertEquals("aaos",initial.getJSONObject("vehicleState").getString("source"));assertTrue(initial.getJSONObject("vehicleState").getBoolean("safe"));capture("01-studio-assigned")
 confirm("배정 확인");state("출발 준비");capture("02-driver-approved")
 confirm("출발 전 업무 시작");state("이동 업무 진행")
 confirm("정차 후 도착 확인");state("도착 확인 · 인계 대기");capture("03-arrived")
 confirm("인계 확인 후 업무 완료");state("업무 완료");capture("04-completed")
 val linked=get("/api/native/studio-link?platformRunId="+origin.getString("platformRunId"));assertEquals(runId,linked.getJSONObject("assignment").getString("runId"));assertEquals("completed",linked.getJSONObject("assignment").getString("state"));assertEquals(0,linked.getJSONObject("assignment").getJSONArray("notices").length())
 File(out,"linked-evidence.json").writeText(linked.toString(2));SystemClock.sleep(3000)
 }
}
