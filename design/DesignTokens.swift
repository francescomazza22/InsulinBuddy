// GENERATED from design/tokens.json by tools/make-tokens.mjs. Do not edit by hand.
// The native iOS app gets real Liquid Glass from the system, so the web glass recipe is deliberately not exported.
import SwiftUI

enum IBTokens {
    enum Light {
        static let ink = Color(hex: 0x17212F)
        static let inkSoft = Color(hex: 0x5B6878)
        static let paper = Color(hex: 0xF4F5F7)
        static let surface = Color(hex: 0xFFFFFF)
        static let line = Color(hex: 0xE1E5EA)
        static let amber = Color(hex: 0xB7740C)
        static let brick = Color(hex: 0xB3422F)
        static let brickSoft = Color(hex: 0xF8E1DC)
        static let green = Color(hex: 0x2E7D55)
    }
    enum Dark {
        static let ink = Color(hex: 0xE8ECF1)
        static let inkSoft = Color(hex: 0xA3AEBB)
        static let paper = Color(hex: 0x0F1318)
        static let surface = Color(hex: 0x181D23)
        static let line = Color(hex: 0x27303A)
        static let brickSoft = Color(hex: 0x3A2420)
    }
    enum Palette {
        static let tealViolet = (acc1: Color(hex: 0x12968B), acc2: Color(hex: 0x7B5CF0), acc3: Color(hex: 0x2FB6E8))
        static let blueViolet = (acc1: Color(hex: 0x2F6FED), acc2: Color(hex: 0x7B5CF0), acc3: Color(hex: 0x4F7CF7))
        static let emeraldRose = (acc1: Color(hex: 0x0FA67A), acc2: Color(hex: 0xE5446D), acc3: Color(hex: 0x2DC993))
        static let orangePink = (acc1: Color(hex: 0xE8590C), acc2: Color(hex: 0xDB3F7C), acc3: Color(hex: 0xF5A524))
        static let cyanIndigo = (acc1: Color(hex: 0x0FA3BD), acc2: Color(hex: 0x5B5BE0), acc3: Color(hex: 0x2F6FED))
        static let greenAmber = (acc1: Color(hex: 0x1FA95B), acc2: Color(hex: 0xE8920C), acc3: Color(hex: 0x7BB32E))
        static let `default` = blueViolet
    }
    enum Radius {
        static let xs: CGFloat = 8
        static let s: CGFloat = 10
        static let m: CGFloat = 16
        static let l: CGFloat = 22
        static let pill: CGFloat = 999
    }
    enum Space {
        static let n3xs: CGFloat = 4
        static let n2xs: CGFloat = 6
        static let xs: CGFloat = 8
        static let s: CGFloat = 10
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 24
    }
    /// Point sizes at the web's 16px base (1rem = 16pt).
    enum FontSize {
        static let n2xs: CGFloat = 10.9
        static let xs: CGFloat = 11.8
        static let s: CGFloat = 12.8
        static let m: CGFloat = 13.8
        static let l: CGFloat = 14.7
        static let body: CGFloat = 16
        static let h3: CGFloat = 17.6
        static let h2: CGFloat = 20.8
        static let h1: CGFloat = 22.4
    }
    enum Motion {
        static let fast = 0.12
        static let base = 0.2
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: 1)
    }
}
