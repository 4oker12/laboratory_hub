#!/usr/bin/env python3
"""Bounded structural parser for original Lua 5.1 bytecode (not decompilation).

The AX23 Quick Setup controller is compiled Lua, not MIPS ELF. Parse the stock
Lua binary structure and emit only schema counts and fixed allowlisted
categories. Never export code, constants, credentials, raw strings or bytecode.
"""
import argparse
import json
from pathlib import Path
import re

CATEGORIES = ("ubus", "uci", "sysmode", "quick_setup", "network",
              "wireless", "wlan", "wan", "config", "interface", "dhcp", "iptv")
SOURCES = (
    "usr/lib/lua/luci/controller/admin/quick_setup.lua",
    "usr/lib/lua/luci/controller/admin/network.lua",
    "usr/lib/lua/luci/controller/admin/wireless.lua",
    "usr/lib/lua/luci/controller/login.lua",
)


class Parser:
    def __init__(self, raw, opaque_vendor_tag9_four_bytes=False):
        self.raw = raw
        # Structural experiment only: the AX23 bytecode uses an unknown tag 9.
        # This option assumes an opaque 4-byte payload, without guessing meaning.
        self.opaque_vendor_tag9_four_bytes = opaque_vendor_tag9_four_bytes
        self.opaque_tag9_occurrences = 0
        self.offset = 0
        self.functions = 0
        self.constants = 0
        self.instructions = 0
        self.categories = set()
        self.prototypes = []
        self.active_prototype = None
        if len(raw) < 12 or raw[:4] != b"\x1bLua" or raw[4] != 0x51:
            raise ValueError("not Lua 5.1 bytecode")
        if raw[5] != 0 or raw[6] not in (0, 1):
            raise ValueError("unsupported format or endian")
        self.byteorder = "little" if raw[6] else "big"
        self.int_size, self.size_t, self.ins_size, self.num_size = raw[7:11]
        if self.int_size not in (4, 8) or self.size_t not in (4, 8):
            raise ValueError("unsupported integer size")
        if self.ins_size != 4 or self.num_size not in (4, 8):
            raise ValueError("unsupported instruction or number size")
        self.offset = 12

    def read(self, n):
        if n < 0 or n > 5_000_000 or self.offset + n > len(self.raw):
            raise ValueError("truncated or oversized data")
        data = self.raw[self.offset:self.offset+n]
        self.offset += n
        return data

    def number(self, size=None):
        n = size or self.int_size
        return int.from_bytes(self.read(n), self.byteorder)

    def count(self, elem_size=1):
        n = self.number()
        if n > 500_000 or n * elem_size > len(self.raw) - self.offset:
            raise ValueError("invalid count or truncated section")
        return n

    def collect(self, value):
        # Only predeclared abstract categories are emitted.
        lowered = value.lower()
        for keyword in CATEGORIES:
            if keyword.encode() in lowered:
                self.categories.add(keyword)
                if self.active_prototype is not None:
                    self.active_prototype["literal_categories"].add(keyword)

    def string(self):
        n = self.number(self.size_t)
        if n == 0:
            return
        if n > 100_000:
            raise ValueError("oversized Lua string")
        self.collect(self.read(n))

    def function(self, depth=0):
        if depth > 70 or self.functions >= 50000:
            raise ValueError("Lua prototype limit exceeded")
        self.functions += 1
        parent_active = self.active_prototype
        self.active_prototype = None
        self.string()  # source name, deliberately not a function literal
        entry = {"proto_index": self.functions, "depth": depth,
                 "literal_categories": set(), "instructions": 0}
        self.prototypes.append(entry)
        entry["line_defined"] = self.number()
        entry["last_line_defined"] = self.number()
        self.read(4)  # upvalues, params, vararg, stacksize
        n = self.count(self.ins_size)
        self.instructions += n
        entry["instructions"] = n
        # Lua 5.1 standard instruction format is assumed only for a *counted*
        # opcode hypothesis; TP-Link might also customize instruction layout.
        # Do NOT output instruction words, constants or disassembly text.
        raw_code = self.read(n * self.ins_size)
        words = [int.from_bytes(raw_code[i:i+4], self.byteorder)
                 for i in range(0, len(raw_code), 4)]
        opcodes = [word & 63 for word in words]
        entry["len_opcode_20_count"] = sum(op == 20 for op in opcodes)
        entry["getupval_opcode_4_count"] = sum(op == 4 for op in opcodes)
        # Stronger *structural* clue: immediately preceding GETUPVAL writes
        # the same register that the following LEN reads. Not runtime proof.
        entry["adjacent_getupval_len_register_pairs"] = sum(
            1 for i in range(1, len(words)) if
            opcodes[i] == 20 and opcodes[i-1] == 4 and
            ((words[i-1] >> 6) & 255) == ((words[i] >> 23) & 511)
        )
        self.active_prototype = entry
        for _ in range(self.count()):
            kind = self.read(1)[0]
            self.constants += 1
            if kind == 0:
                pass
            elif kind == 1:
                self.read(1)
            elif kind == 3:
                self.read(self.num_size)
            elif kind == 4:
                self.string()
            elif kind == 9 and self.opaque_vendor_tag9_four_bytes:
                self.read(4)
                self.opaque_tag9_occurrences += 1
            else:
                raise ValueError("unknown Lua constant tag " + str(kind) +
                                 " at offset " + str(self.offset - 1) +
                                 " in prototype " + str(self.functions))
        self.active_prototype = None
        for _ in range(self.count()):
            self.function(depth + 1)
        self.read(self.count(self.int_size) * self.int_size)  # debug lineinfo
        for _ in range(self.count()):
            self.string()
            self.read(self.int_size * 2)  # variable live ranges
        for _ in range(self.count()):
            self.string()  # debug upvalue names
        self.active_prototype = parent_active

    def report(self):
        self.function()
        return {
            "lua_version": "5.1",
            "endianness": self.byteorder,
            "int_size": self.int_size,
            "size_t_size": self.size_t,
            "function_prototypes": self.functions,
            "instructions": self.instructions,
            "constants": self.constants,
            "opaque_vendor_tag9_four_byte_probes": self.opaque_tag9_occurrences,
            "keyword_categories": sorted(self.categories),
            "prototype_category_map": [
                {"proto_index": p["proto_index"], "depth": p["depth"],
                 "instructions": p["instructions"],
                 "literal_categories": sorted(p["literal_categories"])}
                for p in self.prototypes if p["literal_categories"]
            ],
            "quick_setup_proto_line_map": [
                {"proto_index": p["proto_index"],
                 "depth": p["depth"],
                 "line_defined": p["line_defined"],
                 "last_line_defined": p["last_line_defined"],
                 "instructions": p["instructions"]}
                for p in self.prototypes
            ],
            "quick_setup_opcode_hypothesis": [
                {"proto_index": p["proto_index"],
                 "len_opcode_20_count": p["len_opcode_20_count"],
                 "getupval_opcode_4_count": p["getupval_opcode_4_count"],
                 "adjacent_getupval_len_register_pairs": p["adjacent_getupval_len_register_pairs"]}
                for p in self.prototypes if p["len_opcode_20_count"]
            ],
            "opcode_semantics_confirmed": False,
            "parsed_bytes": self.offset,
            "file_bytes": len(self.raw),
            "complete_parse": self.offset == len(self.raw),
        }


def analyze(rootfs, output):
    records = []
    for name in SOURCES:
        path = rootfs / name
        if not path.is_file() or path.is_symlink():
            records.append({"path": "/" + name, "result": "ABSENT"})
            continue
        try:
            raw = path.read_bytes()
            try:
                stats = Parser(raw).report()
                records.append({"path": "/" + name, "result": "PARSED", **stats})
            except ValueError as strict_error:
                # Fail-closed on interpretation. Try opaque 4-byte extension
                # only when the standard reader stopped on vendor tag 9.
                if "unknown Lua constant tag 9 " not in str(strict_error):
                    raise
                stats = Parser(raw, opaque_vendor_tag9_four_bytes=True).report()
                records.append({"path": "/" + name,
                                "result": "OPAQUE_VENDOR_TAG9_STRUCTURE_PROBE",
                                "vendor_tag9_meaning": "UNKNOWN",
                                **stats})
        except ValueError as err:
            # Header is the standard nonsecret Lua format description (12 bytes).
            # Errors are hardcoded by this parser; no vendor constants exposed.
            records.append({"path": "/" + name, "result": "UNSUPPORTED_OR_TRUNCATED",
                            "lua_header_12_hex": path.read_bytes()[:12].hex(),
                            "reason": str(err)})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"source": "original AX23 Lua 5.1 bytecode",
                                   "controllers": records,
                                   "source_code_or_constants_exported": False},
                                 indent=2, sort_keys=True) + "\n")
    for item in records:
        print("AX23_LUA51_STRUCTURE=" + item["path"] +
              " RESULT=" + item["result"] +
              " PROTOTYPES=" + str(item.get("function_prototypes", 0)) +
              " KEYWORDS=" + ",".join(item.get("keyword_categories", [])) +
              " REASON=" + item.get("reason", "none") +
              " HEADER=" + item.get("lua_header_12_hex", "not_applicable"))
        if "admin/quick_setup.lua" in item["path"]:
            for p in item.get("quick_setup_proto_line_map", []):
                print("AX23_LUA51_QS_SOURCE_LINE_MAP=PROTO_" + str(p["proto_index"]) +
                      " LINE=" + str(p["line_defined"]) +
                      " LAST=" + str(p["last_line_defined"]) +
                      " INS=" + str(p["instructions"]))
            for p in item.get("quick_setup_opcode_hypothesis", []):
                print("AX23_LUA51_QS_LEN_HYPOTHESIS=PROTO_" + str(p["proto_index"]) +
                      " LEN20=" + str(p["len_opcode_20_count"]) +
                      " GETUPVAL4=" + str(p["getupval_opcode_4_count"]) +
                      " ADJACENT_PAIR=" + str(p["adjacent_getupval_len_register_pairs"]))
            for p in item.get("prototype_category_map", []):
                print("AX23_LUA51_QS_PROTO=" + str(p["proto_index"]) +
                      " DEPTH=" + str(p["depth"]) +
                      " LITERALS=" + ",".join(p["literal_categories"]))
    if all(x["result"] == "OPAQUE_VENDOR_TAG9_STRUCTURE_PROBE" and
           x.get("complete_parse") and x.get("opaque_vendor_tag9_four_byte_probes", 0) > 0
           for x in records):
        print("AX23_LUA51_OPAQUE_TAG9_4_BYTE_STRUCTURE=ALL_FOUR_COMPLETE_NOT_DECOMPILED")
    elif not any(x["result"] == "PARSED" for x in records):
        print("AX23_LUA51_STRUCTURE=OPAQUE_OR_DIFFERENT_LUA_ABI_NO_PARSE_CLAIM")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("rootfs", type=Path)
    ap.add_argument("report_json", type=Path)
    args = ap.parse_args()
    analyze(args.rootfs, args.report_json)
