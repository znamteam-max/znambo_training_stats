import Foundation

final class APIClient {
    func send(payload: HealthImportPayload, apiBaseURL: String, importSecret: String) async throws -> ImportResponse {
        let trimmedBaseURL = apiBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        guard let url = URL(string: "\(trimmedBaseURL)/api/health/import") else {
            throw SyncError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(importSecret)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw SyncError.invalidResponse
        }

        let decoded = try JSONDecoder().decode(ImportResponse.self, from: data)

        if !(200..<300).contains(httpResponse.statusCode) {
            throw SyncError.server(decoded.error ?? "HTTP \(httpResponse.statusCode)")
        }

        return decoded
    }
}

enum SyncError: LocalizedError {
    case healthKitUnavailable
    case invalidURL
    case invalidResponse
    case server(String)
    case missingSettings

    var errorDescription: String? {
        switch self {
        case .healthKitUnavailable:
            return "HealthKit is unavailable on this device."
        case .invalidURL:
            return "Invalid API Base URL."
        case .invalidResponse:
            return "Invalid server response."
        case .server(let message):
            return message
        case .missingSettings:
            return "Fill API Base URL, Telegram Chat ID, and Import Secret first."
        }
    }
}
