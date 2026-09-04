import CoreAudio
import Foundation

func property<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _: T.Type) -> T? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: T?
    var size = UInt32(MemoryLayout<T>.size)
    let error = withUnsafeMutablePointer(to: &value) { pointer in
        AudioObjectGetPropertyData(object, &address, 0, nil, &size, pointer)
    }
    return error == noErr ? value : nil
}

let device = property(
    AudioObjectID(kAudioObjectSystemObject),
    kAudioHardwarePropertyDefaultOutputDevice,
    AudioDeviceID.self
)
let running = device
    .flatMap { property($0, kAudioDevicePropertyDeviceIsRunningSomewhere, UInt32.self) }
    .map { $0 != 0 } ?? false
let output: [String: Any] = [
    "defaultOutputDevice": device.map(String.init) ?? "unknown",
    "runningSomewhere": running,
]
let data = try! JSONSerialization.data(withJSONObject: output, options: [])
print(String(data: data, encoding: .utf8)!)
