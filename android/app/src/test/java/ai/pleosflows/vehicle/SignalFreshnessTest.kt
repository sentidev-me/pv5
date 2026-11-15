package ai.pleosflows.vehicle

import org.junit.Assert.*
import org.junit.Test

class SignalFreshnessTest {
    private fun ns(millis: Long) = millis * 1_000_000L
    private fun timing(speedMillis: Long = 9_900, gearMillis: Long = 1_000,
                       readStartedMillis: Long = 9_950, nowMillis: Long = 10_000) =
        SignalFreshness.evaluate(ns(speedMillis), ns(gearMillis), readStartedMillis, ns(nowMillis))

    @Test fun currentContinuousSpeedAndOldOnchangeGearAreValid() {
        val result = timing()
        assertTrue(result.canPublishCurrent)
        assertEquals(9_900L, result.sampledElapsedMillis)
    }
    @Test fun unchangedGearMayBeHoursOldWithoutFalselyLocking() {
        val result = timing(speedMillis = 20_000_000, gearMillis = 1_000,
            readStartedMillis = 20_000_000, nowMillis = 20_000_100)
        assertTrue(result.validGearTimestamp)
        assertTrue(result.canPublishCurrent)
    }
    @Test fun zeroSpeedTimestampCannotBeRestampedBySuccessfulPoll() {
        val result = timing(speedMillis = 0)
        assertFalse(result.freshSpeed)
        assertFalse(result.canPublishCurrent)
        assertEquals(0L, result.sampledElapsedMillis)
    }
    @Test fun negativeSpeedTimestampFailsClosed() {
        assertFalse(timing(speedMillis = -1).canPublishCurrent)
    }
    @Test fun futureSpeedTimestampFailsClosed() {
        assertFalse(timing(speedMillis = 10_001).canPublishCurrent)
    }
    @Test fun continuousSpeedFreshnessIncludesExactBoundaryOnly() {
        assertTrue(timing(speedMillis = 6_500).canPublishCurrent)
        assertFalse(timing(speedMillis = 6_499).canPublishCurrent)
        val justExpired = SignalFreshness.evaluate(ns(6_500), ns(1_000), 9_950, ns(10_000) + 1)
        assertFalse(justExpired.freshSpeed)
    }
    @Test fun cachedSpeedDoesNotBecomeFreshWhenPolledAgain() {
        assertTrue(timing(speedMillis = 9_900).canPublishCurrent)
        val repoll = timing(speedMillis = 9_900, readStartedMillis = 14_000, nowMillis = 14_000)
        assertFalse(repoll.freshSpeed)
        assertFalse(repoll.canPublishCurrent)
    }
    @Test fun publicationDelayRechecksRealSignalAge() {
        val afterRead = timing()
        val whenMainFinallyRuns = timing(nowMillis = 13_401)
        assertTrue(afterRead.canPublishCurrent)
        assertFalse(whenMainFinallyRuns.canPublishCurrent)
    }
    @Test fun slowReadCannotHideBehindNewerSpeedTimestamp() {
        val result = timing(speedMillis = 9_999, readStartedMillis = 6_499)
        assertTrue(result.freshSpeed)
        assertFalse(result.freshReadWindow)
        assertFalse(result.canPublishCurrent)
    }
    @Test fun sampleUsesEarlierReadStartWhenSensorUpdatesDuringRead() {
        val result = timing(speedMillis = 9_990, readStartedMillis = 9_950)
        assertEquals(9_950L, result.sampledElapsedMillis)
    }
    @Test fun sampleUsesEarlierSensorTimestampRatherThanSuccessfulReadTime() {
        val result = timing(speedMillis = 9_000, readStartedMillis = 9_950)
        assertEquals(9_000L, result.sampledElapsedMillis)
    }
    @Test fun zeroNegativeOrFutureGearTimestampFailsClosed() {
        listOf(0L, -1L, 10_001L).forEach {
            assertFalse(timing(gearMillis = it).validGearTimestamp)
            assertFalse(timing(gearMillis = it).canPublishCurrent)
        }
    }
    @Test fun missingOrFutureReadStartFailsClosed() {
        listOf(0L, -1L, 10_001L).forEach {
            assertFalse(timing(readStartedMillis = it).canPublishCurrent)
        }
    }
    @Test fun elapsedClockReversalFailsClosed() {
        assertFalse(timing(nowMillis = 9_000).canPublishCurrent)
        assertFalse(SignalFreshness.evaluate(1L, 1L, 1L, -1L).canPublishCurrent)
    }
    @Test fun timestampArithmeticDoesNotWrapAtLongExtremes() {
        val bad = SignalFreshness.evaluate(Long.MIN_VALUE, Long.MIN_VALUE, Long.MIN_VALUE, Long.MAX_VALUE)
        assertFalse(bad.canPublishCurrent)
        val good = SignalFreshness.evaluate(Long.MAX_VALUE, 1L, Long.MAX_VALUE / 1_000_000L, Long.MAX_VALUE)
        assertTrue(good.canPublishCurrent)
    }
    @Test fun nanosecondFreshnessIsCheckedBeforeMillisecondTruncation() {
        val result = SignalFreshness.evaluate(ns(6_500) - 1L, ns(1_000), 9_950, ns(10_000))
        assertFalse(result.freshSpeed)
    }
}
