import Foundation

struct HealthImportPayload: Codable {
    let telegramChatId: String
    let date: String
    let timezone: String
    let activeEnergyKcal: Double?
    let dietaryEnergyKcal: Double?
    let proteinGrams: Double?
    let carbsGrams: Double?
    let fatGrams: Double?
    let bodyMassKg: Double?
    let sleepMinutes: Int?
    let restingHeartRateBpm: Double?
    let hrvMs: Double?
    let steps: Int?
    let source: String
}

struct ImportResponse: Codable {
    let ok: Bool
    let date: String?
    let summary: String?
    let error: String?
}
