package ai.pleosflows.vehicle

import android.content.Intent
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Host stops only the local test server after NETWORK_READY, then restarts it. */
@RunWith(AndroidJUnit4::class)
class NativeNetworkLossTest {
    @Test fun missingServerLocksNewCommands() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        val device=UiDevice.getInstance(instrumentation)
        context.startActivity(Intent(context,MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        val create=device.wait(Until.findObject(By.text("에뮬레이터 데모 업무 만들기").enabled(true)),15000)
        assertNotNull(create);create!!.click()
        assertTrue(device.wait(Until.hasObject(By.text("배정됨")),15000))
        assertNotNull(device.wait(Until.findObject(By.text("배정 확인").enabled(true)),15000))
        instrumentation.sendStatus(2,Bundle().apply { putString("stream","NETWORK_READY\n") })
        assertTrue(device.wait(Until.hasObject(By.textContains("연결 끊김")),30000))
        val next=device.findObject(By.text("배정 확인"))
        assertNotNull(next);assertFalse(next!!.isEnabled)
        val output=File(context.filesDir,"network-proof").apply { mkdirs() }
        assertTrue(device.takeScreenshot(File(output,"01-server-unavailable-locked.png")))
        device.dumpWindowHierarchy(File(output,"01-server-unavailable-locked.xml"))
    }
}
