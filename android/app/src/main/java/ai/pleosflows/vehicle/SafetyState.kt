package ai.pleosflows.vehicle

import kotlin.math.abs

data class SafetyState(
    val connected: Boolean = false,
    val speedMps: Double? = null,
    val gear: String = "unknown",
    val uxRestricted: Boolean? = null,
    val sampledElapsed: Long = 0L,
    val detail: String = "차량 상태를 확인하고 있습니다"
) {
    fun permitsInteraction(nowElapsed: Long): Boolean = connected && speedMps != null && speedMps.isFinite() &&
        abs(speedMps) <= 0.1 && gear == "P" && uxRestricted == false &&
        sampledElapsed > 0 && nowElapsed >= sampledElapsed && nowElapsed - sampledElapsed <= 3500
    fun reason(nowElapsed: Long): String = when {
        !connected -> "차량 연결 확인 필요"
        sampledElapsed <= 0 || nowElapsed < sampledElapsed || nowElapsed - sampledElapsed > 3500 -> "차량 신호가 오래되어 잠겼습니다"
        speedMps == null || !speedMps.isFinite() || gear == "unknown" || uxRestricted == null -> "차량 상태 확인 필요"
        abs(speedMps) > 0.1 -> "주행 중 · 업무 조작 잠금"
        gear != "P" -> "P단에서 업무를 확인하세요"
        uxRestricted -> "차량 OS가 화면 조작을 제한합니다"
        else -> "정차 · P단 · 화면 조작 허용"
    }
}
