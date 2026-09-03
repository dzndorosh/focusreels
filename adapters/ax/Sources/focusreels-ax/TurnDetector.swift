import Foundation

/// Turns a noisy stream of UI polls into clean turn_started / turn_ended pairs.
///
/// Three defences against false positives, which are the whole risk of an
/// Accessibility adapter:
///   1. a score built from several independent signals, not one button;
///   2. hysteresis — N consecutive agreeing polls before the state flips;
///   3. a watchdog that closes a turn the UI never closed.
final class TurnDetector {
    struct Config {
        var enterThreshold = 3        // busyScore at or above this looks like work
        var confirmations = 2         // consecutive agreeing polls needed to flip
        var maxTurnSeconds: TimeInterval = 600
        var minTurnSeconds: TimeInterval = 0.25  // shorter than this is UI noise
    }

    enum Transition {
        case none
        case started(turnId: String)
        case ended(turnId: String, outcome: String)
    }

    private let config: Config
    private let pid: pid_t
    private var busy = false
    private var agreeing = 0
    private var lastObservation = false
    private var turnCounter = 0
    private var currentTurnId: String?
    private var startedAt: Date?

    init(pid: pid_t, config: Config = Config()) {
        self.pid = pid
        self.config = config
    }

    var isBusy: Bool { busy }

    func observe(_ signals: UISignals, now: Date = Date()) -> Transition {
        let observation = signals.busyScore >= config.enterThreshold

        // Hysteresis: a single odd poll never moves the state.
        if observation == lastObservation {
            agreeing += 1
        } else {
            agreeing = 1
            lastObservation = observation
        }

        if let started = startedAt, busy, now.timeIntervalSince(started) > config.maxTurnSeconds {
            return finish(outcome: "timeout")
        }

        guard agreeing >= config.confirmations, observation != busy else { return .none }

        if observation {
            busy = true
            turnCounter += 1
            let id = "\(pid)-\(turnCounter)"
            currentTurnId = id
            startedAt = now
            return .started(turnId: id)
        }

        // A "turn" shorter than minTurnSeconds is a redraw, not an agent run.
        if let started = startedAt, now.timeIntervalSince(started) < config.minTurnSeconds {
            busy = false
            currentTurnId = nil
            startedAt = nil
            return .none
        }
        return finish(outcome: "completed")
    }

    /// The IDE quit, or we are shutting down: close any open turn.
    func closeIfOpen(outcome: String = "aborted") -> Transition {
        guard busy else { return .none }
        return finish(outcome: outcome)
    }

    private func finish(outcome: String) -> Transition {
        let id = currentTurnId
        busy = false
        currentTurnId = nil
        startedAt = nil
        agreeing = 0
        guard let id else { return .none }
        return .ended(turnId: id, outcome: outcome)
    }
}
