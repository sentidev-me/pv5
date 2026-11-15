package ai.pleosflows.vehicle

/** Pure timestamp policy for AAOS CarPropertyValue elapsed-realtime nanoseconds.
 * Speed is continuous; a successful getter must not renew an old sample's age.
 * Gear is ONCHANGE: its timestamp may be old while its current value remains valid.
 */
object SignalFreshness {
    const val MAX_AGE_MILLIS = 3_500L
    const val MAX_SPEED_AGE_NANOS = MAX_AGE_MILLIS * 1_000_000L
    private const val NANOS_PER_MILLI = 1_000_000L

    data class Timing(
        val freshSpeed: Boolean,
        val validGearTimestamp: Boolean,
        val freshReadWindow: Boolean,
        val sampledElapsedMillis: Long
    ) {
        val canPublishCurrent: Boolean
            get() = freshSpeed && validGearTimestamp && freshReadWindow && sampledElapsedMillis > 0
    }

    /** Call both after the read and immediately before main-thread publication. */
    fun evaluate(speedTimestampNanos: Long, gearTimestampNanos: Long,
                 readStartedElapsedMillis: Long, nowElapsedNanos: Long): Timing {
        val speedNotFuture = speedTimestampNanos > 0 && nowElapsedNanos >= speedTimestampNanos
        val freshSpeed = speedNotFuture && nowElapsedNanos - speedTimestampNanos <= MAX_SPEED_AGE_NANOS
        val validGear = gearTimestampNanos > 0 && nowElapsedNanos >= gearTimestampNanos
        val nowMillis = nowElapsedNanos / NANOS_PER_MILLI
        val freshRead = readStartedElapsedMillis > 0 && nowMillis >= readStartedElapsedMillis &&
            nowMillis - readStartedElapsedMillis <= MAX_AGE_MILLIS
        val sampleAt = if (freshSpeed && freshRead) {
            minOf(readStartedElapsedMillis, speedTimestampNanos / NANOS_PER_MILLI)
        } else 0L
        return Timing(freshSpeed, validGear, freshRead, sampleAt)
    }
}
