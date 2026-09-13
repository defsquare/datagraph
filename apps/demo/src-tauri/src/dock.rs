//! The Dock icon, set by the running process, on macOS.
//!
//! The shipped artifact is a bare Mach-O (ADR-0020, ADR-0033): no `.app`, no
//! `Info.plist`. macOS reads an application icon from a bundle's
//! `Contents/Resources`, and the Tauri bundler — the only reader of
//! `bundle.icon` — is switched off, so the tile falls back to the generic
//! executable image no matter what `icons/` contains.
//!
//! Painting the tile from inside the process is the one way to show the mark
//! without turning the single binary into a bundle. Making it a bundle would
//! drag in Developer ID signing and notarisation for anyone who downloads the
//! tarball instead of installing through the tap — a cost ADR-0033 declined.
//!
//! What this does NOT do: the file on disk stays a Unix executable, so the
//! Finder still draws it generically. Only the Dock and the ⌘-Tab switcher,
//! and only while the app runs.

/// The 512 px application icon, frozen in at compile time. Reading it from
/// disk would put the Dock at the mercy of a file sitting next to a binary
/// that is explicitly distributed alone.
pub const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

#[cfg(target_os = "macos")]
pub fn set_icon() {
  use objc2::{AnyThread, MainThreadMarker};
  use objc2_app_kit::{NSApplication, NSImage};
  use objc2_foundation::NSData;

  // `setApplicationIconImage:` is main-thread only. Tauri's setup hook runs
  // there; should that ever stop being true, we skip the icon rather than
  // race AppKit for it.
  let Some(mtm) = MainThreadMarker::new() else {
    return;
  };

  let data = NSData::with_bytes(ICON_PNG);
  // `None` would mean the embedded bytes stopped being a decodable image —
  // the unit test below is what keeps that from reaching a release.
  let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
    return;
  };

  // SAFETY: objc2 marks the AppKit setters unsafe because it cannot, in
  // general, prove the caller is on the main thread. Here the `MainThreadMarker`
  // obtained above is exactly that proof, and `image` is a live `Retained`
  // whose lifetime outlives the call. Nothing else is passed across.
  unsafe {
    NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image));
  }
}

#[cfg(not(target_os = "macos"))]
pub fn set_icon() {}

#[cfg(test)]
mod tests {
  use super::ICON_PNG;

  /// Guards the one thing that can silently rot: `icons/icon.png` is generated
  /// by a macOS-only script (ADR-0036) that no test runs. If it is regenerated
  /// wrong, or at another size, the Dock gets a blurred tile and nothing else
  /// complains.
  #[test]
  fn the_embedded_icon_is_a_512_png() {
    assert_eq!(&ICON_PNG[..8], b"\x89PNG\r\n\x1a\n", "not a PNG signature");

    // IHDR always comes first: 8 bytes of signature, then the chunk's length
    // and type, then width and height as big-endian u32.
    let width = u32::from_be_bytes(ICON_PNG[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(ICON_PNG[20..24].try_into().unwrap());
    assert_eq!((width, height), (512, 512));
  }
}
