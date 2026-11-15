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
import java.net.HttpURLConnection
import java.net.URL

/** Actual UI commands on genuine AAOS reads, with fictional local workflow data. */
@RunWith(AndroidJUnit4::class)
class NativeJourneyTest {
    @Test fun parkedExplicitJourneyAndCustomerDisclosure() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        val output = File(context.filesDir, "journey-proof").apply { mkdirs() }
        fun get(path: String): JSONObject {
            val c = URL("http://127.0.0.1:3000$path").openConnection() as HttpURLConnection
            try { c.connectTimeout=3000; c.readTimeout=3000; assertEquals(200,c.responseCode)
                return JSONObject(c.inputStream.bufferedReader().use { it.readText() })
            } finally { c.disconnect() }
        }
        fun capture(name: String) {
            device.waitForIdle()
            assertTrue(device.takeScreenshot(File(output,"$name.png")))
            device.dumpWindowHierarchy(File(output,"$name.xml"))
        }
        fun click(text: String) {
            val button=device.wait(Until.findObject(By.text(text).enabled(true)),15000)
            assertNotNull("Expected enabled genuine UI button: $text",button)
            button!!.click()
        }
        fun state(expected: String) {
            assertTrue(device.wait(Until.hasObject(By.text(expected)),15000))
        }
        fun confirm(text: String) { click(text); click("확인") }
        assertFalse(BuildConfig.DEMO_MODE)
        context.startActivity(Intent(context,MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        state("정차 · P단 · 화면 조작 허용")
        capture("01-genuine-parked")
        val existing=get("/api/native/assignment?vehicleId=vehicle-101").optJSONObject("assignment")
        if(existing==null) click("에뮬레이터 데모 업무 만들기")
        else {
            assertEquals("Only resume this test's unadvanced fictional assignment", "assigned", existing.getString("state"))
            assertTrue(existing.getBoolean("destinationIsFixture"))
        }
        state("배정됨")
        val first=get("/api/native/assignment?vehicleId=vehicle-101")
        val runId=first.getJSONObject("assignment").getString("runId")
        assertEquals("aaos",first.getJSONObject("assignment").getString("source"))
        // Fixture creation precedes the next app observation by one sync tick.
        val deadline=SystemClock.elapsedRealtime()+10000
        var observed=get("/api/native/assignment?vehicleId=vehicle-101&runId=$runId")
        while(!observed.getJSONObject("vehicleState").getBoolean("safe") && SystemClock.elapsedRealtime()<deadline) {
            SystemClock.sleep(200)
            observed=get("/api/native/assignment?vehicleId=vehicle-101&runId=$runId")
        }
        assertTrue(observed.getJSONObject("vehicleState").getBoolean("safe"))
        capture("02-assigned")
        confirm("배정 확인"); state("출발 준비")
        confirm("출발 전 업무 시작"); state("이동 업무 진행")
        capture("03-explicit-departed")
        confirm("정차 후 도착 확인"); state("도착 확인 · 인계 대기")
        capture("04-arrived-not-completed")
        click("인계 확인 후 업무 완료"); click("취소")
        assertEquals("arrived",get("/api/native/assignment?vehicleId=vehicle-101&runId=$runId").getJSONObject("assignment").getString("state"))
        confirm("인계 확인 후 업무 완료"); state("업무 완료")
        capture("05-confirmed-completed")
        val final=get("/api/native/assignment?vehicleId=vehicle-101&runId=$runId")
        assertEquals(runId,final.getJSONObject("assignment").getString("runId"))
        assertEquals("completed",final.getJSONObject("assignment").getString("state"))
        val all=get("/api/unified")
        val runs=all.getJSONArray("runs")
        val run=(0 until runs.length()).map { runs.getJSONObject(it) }.single { it.getString("id")==runId }
        val actions=run.getJSONArray("actions")
        assertEquals(2,actions.length())
        for(i in 0 until actions.length()) assertFalse(actions.getJSONObject(i).getBoolean("networkSent"))
        assertTrue(run.isNull("telemetry"))
        val customer=get("/api/unified/customer/${run.getString("customerToken")}?customerId=${run.getString("customerId")}")
        assertEquals("hidden",customer.getString("sharing"))
        assertFalse(final.getJSONObject("limitations").getBoolean("locationOrEtaFromSdk"))
        File(output,"same-run-evidence.json").writeText(JSONObject()
            .put("runId",runId).put("assignment",final.getJSONObject("assignment"))
            .put("customer",customer).put("actions",actions).put("audit",run.getJSONArray("audit"))
            .put("limitations",final.getJSONObject("limitations")).toString(2))
        device.pressHome()
        context.startActivity(Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        state("업무 완료")
        capture("06-completed-after-resume")
        assertEquals(runId,get("/api/native/assignment?vehicleId=vehicle-101&runId=$runId").getJSONObject("assignment").getString("runId"))
    }
}
