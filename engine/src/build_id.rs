//! The build id: what tells one build of `banda` from another, even of the
//! same version, as two builds from a checkout are (ADR 0086, decision 2).
//! It is the ELF build id of `/proc/self/exe` (`NT_GNU_BUILD_ID`), or on
//! macOS the Mach-O UUID (`LC_UUID`), as herdr-core reads its own. The
//! window checks its copy of `banda` by it, through `--version`, and a
//! client finds the running engine's in `engine.json`.
//!
//! Banda is built 64-bit and little-endian (x86_64 and arm64), so only
//! those programs are read; any other has none.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

/// The most of a program's headers or notes read: far more than any has.
const MOST: u64 = 1 << 20;
/// An ELF program header that holds notes.
const PT_NOTE: u32 = 4;
/// The GNU note that holds the build id.
const NT_GNU_BUILD_ID: u32 = 3;
/// The Mach-O load command that holds the UUID.
const LC_UUID: u32 = 0x1b;

/// This program's build id, in hex; none when it has none.
pub fn own() -> Option<String> {
    #[cfg(target_os = "linux")]
    let program = std::path::PathBuf::from("/proc/self/exe");
    #[cfg(not(target_os = "linux"))]
    let program = std::env::current_exe().ok()?;
    of(&mut File::open(program).ok()?)
}

/// The build id of the program `file` holds, in hex.
fn of(file: &mut (impl Read + Seek)) -> Option<String> {
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).ok()?;
    let id = match magic {
        [0x7f, b'E', b'L', b'F'] => elf(file)?,
        [0xcf, 0xfa, 0xed, 0xfe] => mach_o(file)?,
        _ => return None,
    };
    Some(id.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// An ELF's build id, from its program headers' notes: they are loaded
/// with the program, so a stripped one keeps them.
fn elf(file: &mut (impl Read + Seek)) -> Option<Vec<u8>> {
    let header = read_at(file, 0, 64)?;
    // 64-bit (2), little-endian (1).
    if header[4] != 2 || header[5] != 1 {
        return None;
    }
    let table = u64_at(&header, 32);
    let (size, count) = (u16_at(&header, 54) as usize, u16_at(&header, 56) as u64);
    // Each 64-bit program header is 56 bytes, or more.
    if size < 56 {
        return None;
    }
    let programs = read_at(file, table, (count * size as u64).min(MOST))?;
    for program in programs.chunks_exact(size) {
        if u32_at(program, 0) != PT_NOTE {
            continue;
        }
        let (offset, length, align) =
            (u64_at(program, 8), u64_at(program, 32), u64_at(program, 48));
        let notes = read_at(file, offset, length.min(MOST))?;
        if let Some(id) = build_note(&notes, if align == 8 { 8 } else { 4 }) {
            return Some(id);
        }
    }
    None
}

/// The build id among `notes`, each name and description padded to
/// `align`.
fn build_note(notes: &[u8], align: usize) -> Option<Vec<u8>> {
    let padded = |length: usize| length.div_ceil(align) * align;
    let mut at = 0;
    while at + 12 <= notes.len() {
        let (name, description) = (u32_at(notes, at) as usize, u32_at(notes, at + 4) as usize);
        let kind = u32_at(notes, at + 8);
        let named = notes.get(at + 12..at + 12 + name)?;
        let start = at + 12 + padded(name);
        let said = notes.get(start..start + description)?;
        if kind == NT_GNU_BUILD_ID && named == b"GNU\0" {
            return Some(said.to_vec());
        }
        at = start + padded(description);
    }
    None
}

/// A 64-bit Mach-O's UUID, from its load commands.
fn mach_o(file: &mut (impl Read + Seek)) -> Option<Vec<u8>> {
    let header = read_at(file, 0, 32)?;
    let (count, size) = (u32_at(&header, 16), u32_at(&header, 20) as u64);
    let commands = read_at(file, 32, size.min(MOST))?;
    let mut at = 0;
    for _ in 0..count {
        let command = commands.get(at..at + 8)?;
        let (kind, length) = (u32_at(command, 0), u32_at(command, 4) as usize);
        if kind == LC_UUID {
            return commands.get(at + 8..at + 24).map(<[u8]>::to_vec);
        }
        if length < 8 {
            return None;
        }
        at += length;
    }
    None
}

/// `length` bytes of `file` from `offset`; none past its end.
fn read_at(file: &mut (impl Read + Seek), offset: u64, length: u64) -> Option<Vec<u8>> {
    file.seek(SeekFrom::Start(offset)).ok()?;
    let mut bytes = vec![0u8; usize::try_from(length).ok()?];
    file.read_exact(&mut bytes).ok()?;
    Some(bytes)
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().expect("four bytes"))
}

fn u64_at(bytes: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(bytes[at..at + 8].try_into().expect("eight bytes"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// A 64-bit little-endian ELF with a loadable segment, then a segment
    /// of notes: an ABI tag, then the build id `id`.
    fn elf_with(id: &[u8]) -> Vec<u8> {
        let mut notes = Vec::new();
        for (kind, name, said) in [(1u32, &b"GNU\0"[..], &[0u8; 16][..]), (3, b"GNU\0", id)] {
            notes.extend((name.len() as u32).to_le_bytes());
            notes.extend((said.len() as u32).to_le_bytes());
            notes.extend(kind.to_le_bytes());
            notes.extend(name);
            notes.extend(said);
            notes.resize(notes.len().div_ceil(4) * 4, 0);
        }
        let mut file = vec![0u8; 64];
        file[..6].copy_from_slice(&[0x7f, b'E', b'L', b'F', 2, 1]);
        file[32..40].copy_from_slice(&64u64.to_le_bytes());
        file[54..56].copy_from_slice(&56u16.to_le_bytes());
        file[56..58].copy_from_slice(&2u16.to_le_bytes());
        let at = 64 + 2 * 56;
        for (kind, offset, length) in [(1u32, 0u64, 0u64), (PT_NOTE, at, notes.len() as u64)] {
            let mut program = vec![0u8; 56];
            program[0..4].copy_from_slice(&kind.to_le_bytes());
            program[8..16].copy_from_slice(&offset.to_le_bytes());
            program[32..40].copy_from_slice(&length.to_le_bytes());
            program[48..56].copy_from_slice(&4u64.to_le_bytes());
            file.extend(program);
        }
        file.extend(notes);
        file
    }

    /// A 64-bit Mach-O with a segment, then its UUID.
    fn mach_o_with(uuid: [u8; 16]) -> Vec<u8> {
        let mut file = vec![0u8; 32];
        file[..4].copy_from_slice(&[0xcf, 0xfa, 0xed, 0xfe]);
        file[16..20].copy_from_slice(&2u32.to_le_bytes());
        file[20..24].copy_from_slice(&(16u32 + 24).to_le_bytes());
        file.extend(0x19u32.to_le_bytes());
        file.extend(16u32.to_le_bytes());
        file.extend([0u8; 8]);
        file.extend(LC_UUID.to_le_bytes());
        file.extend(24u32.to_le_bytes());
        file.extend(uuid);
        file
    }

    #[test]
    fn an_elf_is_known_by_its_gnu_build_id_note() {
        let file = elf_with(&[0xde, 0xad, 0xbe, 0xef, 0x01]);
        assert_eq!(of(&mut Cursor::new(file)).as_deref(), Some("deadbeef01"));
    }

    #[test]
    fn a_mach_o_is_known_by_its_uuid() {
        let uuid = std::array::from_fn(|at| at as u8);
        assert_eq!(
            of(&mut Cursor::new(mach_o_with(uuid))).as_deref(),
            Some("000102030405060708090a0b0c0d0e0f")
        );
    }

    #[test]
    fn a_script_or_a_cut_program_has_none() {
        assert_eq!(of(&mut Cursor::new(b"#!/bin/sh\necho hi\n".to_vec())), None);
        let mut cut = elf_with(&[1, 2, 3, 4]);
        cut.truncate(150);
        assert_eq!(of(&mut Cursor::new(cut)), None);
    }

    #[test]
    fn a_32_bit_elf_has_none() {
        let mut file = elf_with(&[1, 2, 3, 4]);
        file[4] = 1;
        assert_eq!(of(&mut Cursor::new(file)), None);
    }
}
