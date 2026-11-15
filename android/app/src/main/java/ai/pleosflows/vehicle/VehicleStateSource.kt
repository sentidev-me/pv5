package ai.pleosflows.vehicle

import android.car.Car
import android.car.VehicleGear
import android.car.VehiclePropertyIds
import android.car.drivingstate.CarUxRestrictionsManager
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/** Read-only AAOS path recommended by Pleos. It never writes a vehicle property.
 * A callback may LOCK immediately, but only a consistent three-input poll may unlock.
 */
class VehicleStateSource(private val context: Context, private val publish: (SafetyState) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val reads = Executors.newSingleThreadScheduledExecutor()
    private val guard = Any()
    private var car: Car? = null
    private var properties: CarPropertyManager? = null
    private var restrictions: CarUxRestrictionsManager? = null
    private var propertyListener: CarPropertyManager.CarPropertyEventCallback? = null
    private var polling: ScheduledFuture<*>? = null
    @Volatile private var generation = 0L
    @Volatile private var connectionGeneration = 0L
    @Volatile private var started = false

    // Guarded together. Separate epochs invalidate an in-flight poll even when the
    // changed property has already returned from getProperty(). Event timestamps
    // prevent a cached pre-event property read from reversing a dangerous callback.
    private var speedEpoch = 0L
    private var gearEpoch = 0L
    private var uxEpoch = 0L
    private var speedTimestamp = Long.MIN_VALUE
    private var gearTimestamp = Long.MIN_VALUE
    private var speedBlocked = false
    private var gearBlocked = false
    private var uxBlocked = false
    private data class Epochs(val speed: Long, val gear: Long, val ux: Long)
    private fun epochs() = Epochs(speedEpoch, gearEpoch, uxEpoch)
    private fun live(owner: Long, connection: Long) = started && generation == owner && connectionGeneration == connection
    private fun onMain(action: () -> Unit) {
        if (Looper.myLooper() == main.looper) action() else main.post { action() }
    }
    private fun lockNow(owner: Long, connection: Long, detail: String) = onMain {
        if (live(owner, connection)) publish(SafetyState(detail = detail))
    }
    private fun releaseManagers() {
        polling?.cancel(false); polling = null
        try { propertyListener?.let { properties?.unregisterCallback(it) } } catch (_: Exception) { }
        try { restrictions?.unregisterListener() } catch (_: Exception) { }
        propertyListener = null; properties = null; restrictions = null
    }

    fun start() {
        if (started) return
        started = true
        val owner = ++generation
        publish(SafetyState(detail = "AAOS 차량 서비스 연결 중"))
        try {
            car = Car.createCar(context, main, Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT, Car.CarServiceLifecycleListener { connectedCar, ready ->
                if (!started || generation != owner) return@CarServiceLifecycleListener
                val connection = synchronized(guard) {
                    connectionGeneration++
                    speedEpoch++; gearEpoch++; uxEpoch++
                    speedTimestamp = Long.MIN_VALUE; gearTimestamp = Long.MIN_VALUE
                    speedBlocked = false; gearBlocked = false; uxBlocked = false
                    connectionGeneration
                }
                releaseManagers()
                publish(SafetyState(detail = if (ready) "차량 상태 새로 확인 중" else "차량 서비스 연결 해제"))
                if (!ready) return@CarServiceLifecycleListener
                try {
                    val p = connectedCar.getCarManager(Car.PROPERTY_SERVICE) as CarPropertyManager
                    val u = connectedCar.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as CarUxRestrictionsManager
                    properties = p; restrictions = u
                    val listener = object : CarPropertyManager.CarPropertyEventCallback {
                        override fun onChangeEvent(value: CarPropertyValue<*>) {
                            if (!live(owner, connection)) return
                            val id = value.propertyId
                            if (id != VehiclePropertyIds.PERF_VEHICLE_SPEED && id != VehiclePropertyIds.GEAR_SELECTION) return
                            val available = value.status == CarPropertyValue.STATUS_AVAILABLE
                            val dangerous = if (id == VehiclePropertyIds.PERF_VEHICLE_SPEED) {
                                val speed = if (available) value.value as? Float else null
                                speed == null || !speed.isFinite() || abs(speed) > 0.1f
                            } else {
                                val gear = if (available) value.value as? Int else null
                                gear != VehicleGear.GEAR_PARK
                            }
                            synchronized(guard) {
                                if (!live(owner, connection)) return
                                if (id == VehiclePropertyIds.PERF_VEHICLE_SPEED) {
                                    speedEpoch++
                                    // Out-of-order callbacks may lock, never release a newer veto.
                                    if (value.timestamp >= speedTimestamp) {
                                        speedTimestamp = value.timestamp; speedBlocked = dangerous
                                    } else if (dangerous) speedBlocked = true
                                } else {
                                    gearEpoch++
                                    if (value.timestamp >= gearTimestamp) {
                                        gearTimestamp = value.timestamp; gearBlocked = dangerous
                                    } else if (dangerous) gearBlocked = true
                                }
                            }
                            if (dangerous) lockNow(owner, connection,
                                if (!available) "차량 속성 사용 불가 · 즉시 잠금"
                                else if (id == VehiclePropertyIds.PERF_VEHICLE_SPEED) "속도 변화 감지 · 즉시 잠금"
                                else "P단 이탈/기어 확인 필요 · 즉시 잠금")
                        }
                        override fun onErrorEvent(propertyId: Int, areaId: Int) {
                            if (!live(owner, connection)) return
                            synchronized(guard) {
                                if (!live(owner, connection)) return
                                if (propertyId == VehiclePropertyIds.PERF_VEHICLE_SPEED) { speedEpoch++; speedBlocked = true }
                                else if (propertyId == VehiclePropertyIds.GEAR_SELECTION) { gearEpoch++; gearBlocked = true }
                                else return
                            }
                            lockNow(owner, connection, "차량 속성 오류 · 즉시 잠금")
                        }
                    }
                    propertyListener = listener
                    check(p.registerCallback(listener, VehiclePropertyIds.PERF_VEHICLE_SPEED, CarPropertyManager.SENSOR_RATE_NORMAL))
                    check(p.registerCallback(listener, VehiclePropertyIds.GEAR_SELECTION, CarPropertyManager.SENSOR_RATE_ONCHANGE))
                    u.registerListener { value ->
                        if (live(owner, connection)) {
                            val blocked = value.isRequiresDistractionOptimization || value.activeRestrictions != 0
                            val current = synchronized(guard) {
                                if (live(owner, connection)) { uxEpoch++; uxBlocked = blocked; true } else false
                            }
                            if (current && blocked) lockNow(owner, connection, "차량 OS 주행 제한 활성 · 즉시 잠금")
                        }
                    }
                    polling = reads.scheduleWithFixedDelay({
                        val ticket = synchronized(guard) { if (live(owner, connection)) epochs() else null }
                        if (ticket != null) {
                            // Conservative age: time of first read, not completion of a potentially slow poll.
                            val sampledAt = SystemClock.elapsedRealtime()
                            try {
                                val speed = p.getProperty(Float::class.javaObjectType, VehiclePropertyIds.PERF_VEHICLE_SPEED, 0)
                                val gear = p.getProperty(Int::class.javaObjectType, VehiclePropertyIds.GEAR_SELECTION, 0)
                                val ux = u.currentCarUxRestrictions
                                val speedValue = if (speed?.status == CarPropertyValue.STATUS_AVAILABLE) speed.value.toDouble() else null
                                val gearValue = if (gear?.status == CarPropertyValue.STATUS_AVAILABLE) when (gear.value) {
                                    VehicleGear.GEAR_PARK -> "P"
                                    VehicleGear.GEAR_REVERSE -> "R"
                                    VehicleGear.GEAR_NEUTRAL -> "N"
                                    VehicleGear.GEAR_DRIVE -> "D"
                                    else -> "unknown"
                                } else "unknown"
                                val nowNanos = SystemClock.elapsedRealtimeNanos()
                                val speedStamp = speed?.timestamp ?: 0L
                                val gearStamp = gear?.timestamp ?: 0L
                                val timing = SignalFreshness.evaluate(speedStamp, gearStamp, sampledAt, nowNanos)
                                val sample = SafetyState(true, if(timing.freshSpeed) speedValue else null, if(timing.validGearTimestamp) gearValue else "unknown",
                                    ux?.let { it.isRequiresDistractionOptimization || it.activeRestrictions != 0 },
                                    timing.sampledElapsedMillis, "AAOS 속도·기어·UX 조회")
                                main.post {
                                    synchronized(guard) {
                                        // Invalidation is checked on MAIN immediately before publish. A
                                        // dangerous callback that happened after any read wins over this poll.
                                        if (live(owner, connection) && ticket == epochs()) {
                                            val oldSpeed = speed == null || speed.timestamp < speedTimestamp ||
                                                (speedBlocked && speed.timestamp <= speedTimestamp)
                                            val oldGear = gear == null || gear.timestamp < gearTimestamp ||
                                                (gearBlocked && gear.timestamp <= gearTimestamp)
                                            val publicationTiming = SignalFreshness.evaluate(speedStamp, gearStamp, sampledAt, SystemClock.elapsedRealtimeNanos())
                                            if (!publicationTiming.canPublishCurrent) {
                                                publish(SafetyState(detail = "차량 신호 시각/신선도 확인 필요 · 잠금 유지"))
                                            } else if (oldSpeed || oldGear || uxBlocked) {
                                                publish(SafetyState(detail = "더 최신 차량 제한 신호를 확인 중 · 잠금 유지"))
                                            } else {
                                                Log.i("PleosFlowsVehicle", "AAOS_READ speedMps=${sample.speedMps} gear=${sample.gear} uxRestricted=${sample.uxRestricted} sampledElapsed=${sample.sampledElapsed}")
                                                publish(sample)
                                            }
                                        }
                                    }
                                }
                            } catch (_: SecurityException) {
                                lockNow(owner, connection, "차량 읽기 권한 확인 필요 · 잠금 유지")
                            } catch (_: Exception) {
                                lockNow(owner, connection, "차량 조회 실패 · 잠금 유지")
                            }
                        }
                    }, 0, 1, TimeUnit.SECONDS)
                } catch (_: SecurityException) {
                    releaseManagers(); lockNow(owner, connection, "차량 읽기 권한 사용 불가 · 잠금 유지")
                } catch (_: Exception) {
                    releaseManagers(); lockNow(owner, connection, "차량 API 사용 불가 · 잠금 유지")
                }
            })
        } catch (_: SecurityException) {
            publish(SafetyState(detail = "AAOS 연결 권한 사용 불가 · 잠금 유지"))
        } catch (_: Exception) {
            publish(SafetyState(detail = "AAOS 서비스 없는 환경 · 잠금 유지"))
        }
    }
    fun stop() {
        synchronized(guard) {
            started = false; generation++; connectionGeneration++
            speedEpoch++; gearEpoch++; uxEpoch++
        }
        releaseManagers()
        try { car?.disconnect() } catch (_: Exception) { }
        car = null
        publish(SafetyState(detail = "앱이 비활성 상태입니다"))
    }
    fun close() { stop(); reads.shutdownNow() }
}
