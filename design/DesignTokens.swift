// GENERATED from design/tokens.json by tools/make-tokens.mjs. Do not edit by hand.
// The native iOS app gets real Liquid Glass from the system, so the web glass recipe is deliberately not exported.
import SwiftUI

enum IBTokens {
    enum Light {
        static let ink = Color(hex: 0x1B2A3A)
        static let inkSoft = Color(hex: 0x6B7A89)
        static let paper = Color(hex: 0xF5F3EE)
        static let surface = Color(hex: 0xFFFFFF)
        static let line = Color(hex: 0xE4E1D8)
        static let amber = Color(hex: 0xC8862E)
        static let brick = Color(hex: 0xA34A3B)
        static let brickSoft = Color(hex: 0xF1DCD6)
        static let green = Color(hex: 0x4C7A5E)
    }
    enum Dark {
        static let ink = Color(hex: 0xECEAE3)
        static let inkSoft = Color(hex: 0x9AA6B2)
        static let paper = Color(hex: 0x14181D)
        static let surface = Color(hex: 0x1C2127)
        static let line = Color(hex: 0x2B3138)
        static let brickSoft = Color(hex: 0x3A2420)
    }
    enum Palette {
        static let tealViolet = (acc1: Color(hex: 0x1F9E93), acc2: Color(hex: 0x8B5CF6), acc3: Color(hex: 0x38BDF8))
        static let blueViolet = (acc1: Color(hex: 0x3B82F6), acc2: Color(hex: 0x8B5CF6), acc3: Color(hex: 0x6366F1))
        static let emeraldRose = (acc1: Color(hex: 0x10B981), acc2: Color(hex: 0xF43F5E), acc3: Color(hex: 0x34D399))
        static let orangePink = (acc1: Color(hex: 0xF97316), acc2: Color(hex: 0xEC4899), acc3: Color(hex: 0xF59E0B))
        static let cyanIndigo = (acc1: Color(hex: 0x22B8CE), acc2: Color(hex: 0x6366F1), acc3: Color(hex: 0x3B82F6))
        static let greenAmber = (acc1: Color(hex: 0x22C55E), acc2: Color(hex: 0xF59E0B), acc3: Color(hex: 0x84CC16))
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
