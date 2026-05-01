import Foundation
import HealthKit

final class HealthKitSyncService {
    private let healthStore = HKHealthStore()

    private var quantityTypes: [HKQuantityTypeIdentifier] {
        [
            .activeEnergyBurned,
            .dietaryEnergyConsumed,
            .dietaryProtein,
            .dietaryCarbohydrates,
            .dietaryFatTotal,
            .bodyMass,
            .restingHeartRate,
            .heartRateVariabilitySDNN,
            .stepCount,
        ]
    }

    private var readTypes: Set<HKObjectType> {
        var types = Set(quantityTypes.compactMap { HKObjectType.quantityType(forIdentifier: $0) })

        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(sleepType)
        }

        return types
    }

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw SyncError.healthKitUnavailable
        }

        try await withCheckedThrowingContinuation { continuation in
            healthStore.requestAuthorization(toShare: Set<HKSampleType>(), read: readTypes) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: SyncError.healthKitUnavailable)
                }
            }
        }
    }

    func collectToday(telegramChatId: String) async throws -> HealthImportPayload {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let end = Date()

        async let activeEnergy = cumulativeSum(.activeEnergyBurned, unit: .kilocalorie(), start: start, end: end)
        async let dietaryEnergy = cumulativeSum(.dietaryEnergyConsumed, unit: .kilocalorie(), start: start, end: end)
        async let protein = cumulativeSum(.dietaryProtein, unit: .gram(), start: start, end: end)
        async let carbs = cumulativeSum(.dietaryCarbohydrates, unit: .gram(), start: start, end: end)
        async let fat = cumulativeSum(.dietaryFatTotal, unit: .gram(), start: start, end: end)
        async let bodyMass = latestQuantity(.bodyMass, unit: .gramUnit(with: .kilo), start: start, end: end)
        async let restingHeartRate = averageQuantity(
            .restingHeartRate,
            unit: HKUnit.count().unitDivided(by: .minute()),
            start: start,
            end: end
        )
        async let hrv = averageQuantity(.heartRateVariabilitySDNN, unit: .secondUnit(with: .milli), start: start, end: end)
        async let steps = cumulativeSum(.stepCount, unit: .count(), start: start, end: end)
        async let sleepMinutes = sleepMinutes(start: start, end: end)
        let stepValue = try await steps

        return HealthImportPayload(
            telegramChatId: telegramChatId,
            date: Self.dateFormatter.string(from: start),
            timezone: TimeZone.current.identifier,
            activeEnergyKcal: try await activeEnergy,
            dietaryEnergyKcal: try await dietaryEnergy,
            proteinGrams: try await protein,
            carbsGrams: try await carbs,
            fatGrams: try await fat,
            bodyMassKg: try await bodyMass,
            sleepMinutes: try await sleepMinutes,
            restingHeartRateBpm: try await restingHeartRate,
            hrvMs: try await hrv,
            steps: stepValue.map { Int($0.rounded()) },
            source: "healthkit-ios"
        )
    }

    private func cumulativeSum(
        _ identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        start: Date,
        end: Date
    ) async throws -> Double? {
        guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
            return nil
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: quantityType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: statistics?.sumQuantity()?.doubleValue(for: unit))
            }

            healthStore.execute(query)
        }
    }

    private func averageQuantity(
        _ identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        start: Date,
        end: Date
    ) async throws -> Double? {
        guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
            return nil
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: quantityType,
                quantitySamplePredicate: predicate,
                options: .discreteAverage
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: statistics?.averageQuantity()?.doubleValue(for: unit))
            }

            healthStore.execute(query)
        }
    }

    private func latestQuantity(
        _ identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        start: Date,
        end: Date
    ) async throws -> Double? {
        guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
            return nil
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictEndDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: quantityType,
                predicate: predicate,
                limit: 1,
                sortDescriptors: [sort]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let sample = samples?.first as? HKQuantitySample
                continuation.resume(returning: sample?.quantity.doubleValue(for: unit))
            }

            healthStore.execute(query)
        }
    }

    private func sleepMinutes(start: Date, end: Date) async throws -> Int? {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            return nil
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: sleepType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let asleepValues: Set<Int> = [
                    HKCategoryValueSleepAnalysis.asleep.rawValue,
                    HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                    HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                    HKCategoryValueSleepAnalysis.asleepREM.rawValue,
                ]

                let seconds = (samples as? [HKCategorySample] ?? []).reduce(0.0) { total, sample in
                    guard asleepValues.contains(sample.value) else {
                        return total
                    }

                    let overlapStart = max(sample.startDate, start)
                    let overlapEnd = min(sample.endDate, end)

                    return total + max(0, overlapEnd.timeIntervalSince(overlapStart))
                }

                continuation.resume(returning: Int((seconds / 60).rounded()))
            }

            healthStore.execute(query)
        }
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
