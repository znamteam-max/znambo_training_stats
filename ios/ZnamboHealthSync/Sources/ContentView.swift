import SwiftUI

struct ContentView: View {
    @AppStorage("apiBaseURL") private var apiBaseURL = "https://znambo-training-stats.vercel.app"
    @AppStorage("telegramChatId") private var telegramChatId = ""
    @AppStorage("healthImportSecret") private var healthImportSecret = ""

    @State private var isWorking = false
    @State private var status = "Fill settings, allow Health access, then sync today."

    private let healthService = HealthKitSyncService()
    private let apiClient = APIClient()

    var body: some View {
        NavigationStack {
            Form {
                Section("Backend") {
                    TextField("API Base URL", text: $apiBaseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    TextField("Telegram Chat ID", text: $telegramChatId)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.numberPad)

                    SecureField("Import Secret", text: $healthImportSecret)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section("Actions") {
                    Button {
                        requestHealthAccess()
                    } label: {
                        Label("Request Apple Health Access", systemImage: "heart.text.square")
                    }
                    .disabled(isWorking)

                    Button {
                        syncToday()
                    } label: {
                        Label("Sync Today", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled(isWorking)
                }

                Section("Status") {
                    if isWorking {
                        ProgressView()
                    }

                    Text(status)
                        .textSelection(.enabled)
                }
            }
            .navigationTitle("Znambo Health Sync")
        }
    }

    private func requestHealthAccess() {
        isWorking = true
        status = "Requesting Apple Health access..."

        Task {
            do {
                try await healthService.requestAuthorization()
                await updateStatus("Health access granted. Now tap Sync Today.")
            } catch {
                await updateStatus("Health access failed: \(error.localizedDescription)")
            }
        }
    }

    private func syncToday() {
        guard !apiBaseURL.isEmpty, !telegramChatId.isEmpty, !healthImportSecret.isEmpty else {
            status = SyncError.missingSettings.localizedDescription
            return
        }

        isWorking = true
        status = "Reading Apple Health and sending to bot..."

        Task {
            do {
                let payload = try await healthService.collectToday(telegramChatId: telegramChatId)
                let response = try await apiClient.send(
                    payload: payload,
                    apiBaseURL: apiBaseURL,
                    importSecret: healthImportSecret
                )

                await updateStatus(response.summary ?? "Synced \(response.date ?? payload.date).")
            } catch {
                await updateStatus("Sync failed: \(error.localizedDescription)")
            }
        }
    }

    @MainActor
    private func updateStatus(_ value: String) {
        status = value
        isWorking = false
    }
}

#Preview {
    ContentView()
}
