// Creates/reuses a release seed in the login Keychain. Prints PUBLIC key only.
import Foundation
import CryptoKit
import Security

let platform = CommandLine.arguments.dropFirst().first ?? ""
guard ["macos", "windows"].contains(platform) else { fatalError("Expected release platform") }
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
  kSecAttrService as String: "com.innogrid.innocrew.desktop-update.ed25519",
  kSecAttrAccount as String: platform]
var found: CFTypeRef?
var read = query; read[kSecReturnData as String] = true
let status = SecItemCopyMatching(read as CFDictionary, &found)
let key: Curve25519.Signing.PrivateKey
if status == errSecSuccess {
  guard let data = found as? Data, let text = String(data: data, encoding: .utf8), let seed = Data(base64Encoded: text) else { fatalError("Invalid stored update key") }
  key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
} else if status == errSecItemNotFound {
  key = Curve25519.Signing.PrivateKey()
  var item = query
  item[kSecValueData as String] = Data(key.rawRepresentation.base64EncodedString().utf8)
  item[kSecAttrLabel as String] = "InnoCrew \(platform) update signing"
  guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { fatalError("Could not store update key") }
} else { fatalError("Update Keychain is not accessible") }
print(key.publicKey.rawRepresentation.base64EncodedString())
