package ai.pleosflows.vehicle

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Copies this app's earlier test captures out of AAOS app storage namespaces. */
@RunWith(AndroidJUnit4::class)
class CollectRuntimeProofTest {
    @Test fun collectAppOwnedScreenshots() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val source=File(context.getExternalFilesDir(null),"runtime-proof")
        val target=File(context.filesDir,"recovered-runtime-proof").apply { mkdirs() }
        assertTrue("Earlier fresh-install captures should exist",source.isDirectory)
        val files=source.listFiles() ?: emptyArray()
        assertTrue(files.size>=8)
        files.forEach { it.copyTo(File(target,it.name),overwrite=true) }
    }
}
