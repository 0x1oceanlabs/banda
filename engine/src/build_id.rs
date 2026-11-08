//! The build id: what tells one build of `banda` from another, even of the
//! same version, as two builds from a checkout are (ADR 0086, decision 2).
//! It is the ELF build id of `/proc/self/exe` (`NT_GNU_BUILD_ID`), or on
//! macOS the Mach-O UUID (`LC_UUID`), as herdr-core reads its own, or on
//! Windows the GUID and age of the PE's CodeView record (`RSDS`), which
//! also name its `banda.pdb` (ADR 0090, decision 3). The window checks its
//! copy of `banda` by it, through `--version`, and a client finds the
//! running engine's in `engine.json`.
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
/// A 64-bit PE's optional header (PE32+).
const PE32_PLUS: u16 = 0x20b;
/// The PE's data directory of debug records, by its place in the list.
const DEBUG_DIRECTORY: usize = 6;
/// The debug record that holds the CodeView record.
const IMAGE_DEBUG_TYPE_CODEVIEW: u32 = 2;

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
        [b'M', b'Z', _, _] => return pe(file),
        _ => return None,
    };
    Some(hex(&id))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
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

/// A 64-bit PE's GUID and age, from its CodeView record, as a symbol
/// server names its PDB: the GUID's fields in their order, then the age.
/// The linker writes the record with `/DEBUG`, which Rust asks for when a
/// crate keeps line tables, as Banda's do (`Cargo.toml`'s profiles).
fn pe(file: &mut (impl Read + Seek)) -> Option<String> {
    let header = read_at(file, 0, 64)?;
    let at = u64::from(u32_at(&header, 0x3c));
    let coff = read_at(file, at, 24)?;
    if coff[..4] != *b"PE\0\0" {
        return None;
    }
    let (sections, optional) = (u16_at(&coff, 6), u16_at(&coff, 20));
    let optional_at = at + 24;
    let optional = read_at(file, optional_at, u64::from(optional))?;
    if optional.len() < 112 || u16_at(&optional, 0) != PE32_PLUS {
        return None;
    }
    let directories = u32_at(&optional, 108) as usize;
    let entry = 112 + DEBUG_DIRECTORY * 8;
    if directories <= DEBUG_DIRECTORY || optional.len() < entry + 8 {
        return None;
    }
    let (address, size) = (u32_at(&optional, entry), u32_at(&optional, entry + 4));
    let table = read_at(
        file,
        optional_at + optional.len() as u64,
        (u64::from(sections) * 40).min(MOST),
    )?;
    // Where the debug records are in the file, by the section that holds
    // them in memory.
    let offset = table.as_chunks::<40>().0.iter().find_map(|section| {
        let (size, start) = (u32_at(section, 8), u32_at(section, 12));
        let (raw, raw_at) = (u32_at(section, 16), u32_at(section, 20));
        let within = address >= start && address - start < size.max(raw);
        within.then(|| u64::from(raw_at) + u64::from(address - start))
    })?;
    let records = read_at(file, offset, u64::from(size).min(MOST))?;
    records.as_chunks::<28>().0.iter().find_map(|record| {
        if u32_at(record, 12) != IMAGE_DEBUG_TYPE_CODEVIEW {
            return None;
        }
        let codeview = read_at(file, u64::from(u32_at(record, 24)), 24)?;
        if codeview[..4] != *b"RSDS" {
            return None;
        }
        let guid = &codeview[4..20];
        let (first, second, third) = (u32_at(guid, 0), u16_at(guid, 4), u16_at(guid, 6));
        let age = u32_at(&codeview, 20);
        Some(format!(
            "{first:08x}{second:04x}{third:04x}{}{age:x}",
            hex(&guid[8..])
        ))
    })
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

    /// A 64-bit PE with one section, which holds a CodeView record of
    /// `guid` and `age`, behind a debug record of another kind.
    fn pe_with(guid: [u8; 16], age: u32) -> Vec<u8> {
        let mut file = vec![0u8; 0x600];
        file[..2].copy_from_slice(b"MZ");
        file[0x3c..0x40].copy_from_slice(&0x40u32.to_le_bytes());
        file[0x40..0x44].copy_from_slice(b"PE\0\0");
        // The COFF header: one section, an optional header of 240 bytes.
        file[0x46..0x48].copy_from_slice(&1u16.to_le_bytes());
        file[0x54..0x56].copy_from_slice(&240u16.to_le_bytes());
        let optional = 0x58;
        file[optional..optional + 2].copy_from_slice(&PE32_PLUS.to_le_bytes());
        file[optional + 108..optional + 112].copy_from_slice(&16u32.to_le_bytes());
        let debug = optional + 112 + DEBUG_DIRECTORY * 8;
        file[debug..debug + 4].copy_from_slice(&0x1010u32.to_le_bytes());
        file[debug + 4..debug + 8].copy_from_slice(&56u32.to_le_bytes());
        // Its one section: at 0x1000 in memory, 0x400 in the file.
        let section = optional + 240;
        for (at, value) in [(8, 0x200u32), (12, 0x1000), (16, 0x200), (20, 0x400)] {
            file[section + at..section + at + 4].copy_from_slice(&value.to_le_bytes());
        }
        for (record, (kind, data)) in [(0x410, (16u32, 0x480u32)), (0x42c, (2, 0x500))] {
            file[record + 12..record + 16].copy_from_slice(&kind.to_le_bytes());
            file[record + 24..record + 28].copy_from_slice(&data.to_le_bytes());
        }
        file[0x500..0x504].copy_from_slice(b"RSDS");
        file[0x504..0x514].copy_from_slice(&guid);
        file[0x514..0x518].copy_from_slice(&age.to_le_bytes());
        file[0x518..0x522].copy_from_slice(b"banda.pdb\0");
        file
    }

    #[test]
    fn a_pe_is_known_by_its_codeview_guid_and_age() {
        // {3F2504E0-4F89-11D3-9A0C-0305E82C3301}, as the file holds it.
        let guid = [
            0xe0, 0x04, 0x25, 0x3f, 0x89, 0x4f, 0xd3, 0x11, 0x9a, 0x0c, 0x03, 0x05, 0xe8, 0x2c,
            0x33, 0x01,
        ];
        let id = of(&mut Cursor::new(pe_with(guid, 1)));
        assert_eq!(id.as_deref(), Some("3f2504e04f8911d39a0c0305e82c33011"));
        let again = of(&mut Cursor::new(pe_with(guid, 0x2a)));
        assert_eq!(again.as_deref(), Some("3f2504e04f8911d39a0c0305e82c33012a"));
    }

    #[test]
    fn a_pe_without_a_codeview_record_or_32_bit_has_none() {
        let mut none = pe_with([7; 16], 1);
        none[0x500..0x504].copy_from_slice(b"NB10");
        assert_eq!(of(&mut Cursor::new(none)), None);
        let mut small = pe_with([7; 16], 1);
        small[0x58..0x5a].copy_from_slice(&0x10bu16.to_le_bytes());
        assert_eq!(of(&mut Cursor::new(small)), None);
        let mut cut = pe_with([7; 16], 1);
        cut.truncate(0x480);
        assert_eq!(of(&mut Cursor::new(cut)), None);
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
