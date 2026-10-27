// GENERATED from design/tokens.json by tools/make-tokens.mjs. Do not edit by hand.
// The native iOS app gets real Liquid Glass from the system, so the web glass recipe is deliberately not exported.
import SwiftUI

enum IBTokens {
    enum Light {
        static let ink = Color(hex: 0x000000)
        static let inkSoft = Color(hex: 0x6C6C70)
        static let paper = Color(hex: 0xF2F2F7)
        static let surface = Color(hex: 0xFFFFFF)
        static let line = Color(hex: 0xD1D1D6)
        static let amber = Color(hex: 0xC93400)
        static let brick = Color(hex: 0xD70015)
        static let brickSoft = Color(hex: 0xFFE5E6)
        static let green = Color(hex: 0x248A3D)
    }
    enum Dark {
        static let ink = Color(hex: 0xFFFFFF)
        static let inkSoft = Color(hex: 0xA1A1A6)
        static let paper = Color(hex: 0x000000)
        static let surface = Color(hex: 0x1C1C1E)
        static let line = Color(hex: 0x38383A)
        static let amber = Color(hex: 0xFF9230)
        static let brick = Color(hex: 0xFF4245)
        static let brickSoft = Color(hex: 0x3A1D1F)
        static let green = Color(hex: 0x30D158)
    }
    enum Palette {
        static let redOrange = (acc1: Color(hex: 0xD70015), acc2: Color(hex: 0xFF8D28), acc3: Color(hex: 0xD70015), acc1Dark: Color(hex: 0xFB6458), acc2Dark: Color(hex: 0xFF9230), fill: Color(hex: 0xD70015), fillDark: Color(hex: 0xD70015), card1: Color(hex: 0xD70015), card2: Color(hex: 0xFF8D28), card1Dark: Color(hex: 0xC90916), card2Dark: Color(hex: 0x944D09))
        static let orangeYellow = (acc1: Color(hex: 0xC93400), acc2: Color(hex: 0xFFCC00), acc3: Color(hex: 0xC93400), acc1Dark: Color(hex: 0xFB653E), acc2Dark: Color(hex: 0xFFD600), fill: Color(hex: 0xC93400), fillDark: Color(hex: 0xC93400), card1: Color(hex: 0xC93400), card2: Color(hex: 0xFFCC00), card1Dark: Color(hex: 0xB3330E), card2Dark: Color(hex: 0x88530C))
        static let greenMint = (acc1: Color(hex: 0x248A3D), acc2: Color(hex: 0x00C8B3), acc3: Color(hex: 0x248A3D), acc1Dark: Color(hex: 0x47A859), acc2Dark: Color(hex: 0x00DAC3), fill: Color(hex: 0x248A3D), fillDark: Color(hex: 0x1D8539), card1: Color(hex: 0x248A3D), card2: Color(hex: 0x00C8B3), card1Dark: Color(hex: 0x036F28), card2Dark: Color(hex: 0x0F6C60))
        static let tealCyan = (acc1: Color(hex: 0x008299), acc2: Color(hex: 0x00C0E8), acc3: Color(hex: 0x008299), acc1Dark: Color(hex: 0x39A1B8), acc2Dark: Color(hex: 0x3CD3FE), fill: Color(hex: 0x008299), fillDark: Color(hex: 0x168095), card1: Color(hex: 0x008299), card2: Color(hex: 0x00C0E8), card1Dark: Color(hex: 0x0A687B), card2Dark: Color(hex: 0x11697E))
        static let blueIndigo = (acc1: Color(hex: 0x0088FF), acc2: Color(hex: 0x6155F5), acc3: Color(hex: 0x0088FF), acc1Dark: Color(hex: 0x4197FA), acc2Dark: Color(hex: 0x6D7CFF), fill: Color(hex: 0x0088FF), fillDark: Color(hex: 0x0374DA), card1: Color(hex: 0x0088FF), card2: Color(hex: 0x6155F5), card1Dark: Color(hex: 0x1060B2), card2Dark: Color(hex: 0x5645E5))
        static let purplePink = (acc1: Color(hex: 0xCB30E0), acc2: Color(hex: 0xFF2D55), acc3: Color(hex: 0xCB30E0), acc1Dark: Color(hex: 0xE651FC), acc2Dark: Color(hex: 0xFF375F), fill: Color(hex: 0xCB30E0), fillDark: Color(hex: 0xC323D7), card1: Color(hex: 0xCB30E0), card2: Color(hex: 0xFF2D55), card1Dark: Color(hex: 0xAB0FBE), card2Dark: Color(hex: 0xC8043A))
        static let `default` = blueIndigo
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
        static let n2xs: CGFloat = 11
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
