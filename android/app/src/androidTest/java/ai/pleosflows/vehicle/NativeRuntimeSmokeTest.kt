package ai.pleosflows.vehicle

import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Genuine Vehicle UI test. Requires a fresh local Pleos test installation.
 * It never sets a vehicle property or substitutes a signal source.
 */
@RunWith(AndroidJUnit4::class)
class NativeRuntimeSmokeTest {
    @Test fun permissionDenialThenRealAaosLaunch() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        val output = File(context.filesDir, "runtime-proof").apply { mkdirs() }
        fun capture(name: String) {
            device.waitForIdle()
            assertTrue(device.takeScreenshot(File(output, "$name.png")))
            device.dumpWindowHierarchy(File(output, "$name.xml"))
        }
        fun launch() {
            context.startActivity(Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        }
        assertFalse(BuildConfig.DEMO_MODE)
        assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission("android.car.permission.CAR_SPEED"))
        launch()
        val deny = device.wait(Until.findObject(By.text("허용 안함")), 10000)
        assertNotNull("Expected the real OS speed-permission dialog", deny)
        capture("01-permission-request")
        deny!!.click()
        assertTrue(device.wait(Until.hasObject(By.text("차량 속도 읽기 권한이 없어 잠겼습니다")), 10000))
        capture("02-permission-denied")
        assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission("android.car.permission.CAR_SPEED"))
        launch()
        val allow = device.wait(Until.findObject(By.text("허용")), 10000)
        assertNotNull("Expected OS permission retry", allow)
        allow!!.click()
        assertTrue(device.wait(Until.gone(By.pkg("com.android.permissioncontroller")), 10000))
        assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission("android.car.permission.CAR_SPEED"))
        assertTrue(device.wait(Until.hasObject(By.textContains("PLEOS / AAOS")), 10000))
        capture("03-aaos-foreground")
        device.pressHome()
        launch()
        assertTrue(device.wait(Until.hasObject(By.textContains("PLEOS / AAOS")), 10000))
        capture("04-aaos-resumed")
    }
}
