package ai.pleosflows.vehicle
import org.junit.Assert.*
import org.junit.Test
class SafetyStateTest {
    private val parked = SafetyState(true, 0.0, "P", false, 1000)
    @Test fun parkedAndUnrestrictedAllows() { assertTrue(parked.permitsInteraction(2000)) }
    @Test fun reverseMovementLocks() { assertFalse(parked.copy(speedMps = -4.0).permitsInteraction(2000)) }
    @Test fun forwardMovementLocks() { assertFalse(parked.copy(speedMps = 1.0).permitsInteraction(2000)) }
    @Test fun nonParkGearLocks() { listOf("R","D","N","unknown").forEach { assertFalse(parked.copy(gear=it).permitsInteraction(2000)) } }
    @Test fun osRestrictionWins() { assertFalse(parked.copy(uxRestricted=true).permitsInteraction(2000)) }
    @Test fun missingUxLocks() { assertFalse(parked.copy(uxRestricted=null).permitsInteraction(2000)) }
    @Test fun staleLocks() { assertFalse(parked.permitsInteraction(4501)) }
    @Test fun clockReversalLocks() { assertFalse(parked.permitsInteraction(999)) }
    @Test fun disconnectedLocks() { assertFalse(parked.copy(connected=false).permitsInteraction(2000)) }
    @Test fun nonfiniteLocks() { listOf(Double.NaN,Double.POSITIVE_INFINITY,Double.NEGATIVE_INFINITY).forEach { assertFalse(parked.copy(speedMps=it).permitsInteraction(2000)) } }
    @Test fun missingSpeedLocks() { assertFalse(parked.copy(speedMps=null).permitsInteraction(2000)) }
    @Test fun missingTimestampLocks() { assertFalse(parked.copy(sampledElapsed=0).permitsInteraction(2000)) }
}
