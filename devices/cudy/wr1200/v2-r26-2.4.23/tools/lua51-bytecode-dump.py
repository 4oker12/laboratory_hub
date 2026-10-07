#!/usr/bin/env python3
"""Minimal Lua 5.1 bytecode dumper for exact WR1200 stock chunks.

This is target-local research tooling. It parses the stock chunk header instead
of assuming the host luac ABI, so 32-bit MIPS chunks can be inspected on x86_64.
It does not execute or rewrite the chunk.
"""

from __future__ import annotations

import argparse
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any


OPNAMES = [
    "MOVE", "LOADK", "LOADBOOL", "LOADNIL", "GETUPVAL", "GETGLOBAL",
    "GETTABLE", "SETGLOBAL", "SETUPVAL", "SETTABLE", "NEWTABLE", "SELF",
    "ADD", "SUB", "MUL", "DIV", "MOD", "POW", "UNM", "NOT", "LEN",
    "CONCAT", "JMP", "EQ", "LT", "LE", "TEST", "TESTSET", "CALL",
    "TAILCALL", "RETURN", "FORLOOP", "FORPREP", "TFORLOOP", "SETLIST",
    "CLOSE", "CLOSURE", "VARARG",
]

ABX = {"LOADK", "GETGLOBAL", "SETGLOBAL", "CLOSURE"}
ASBX = {"JMP", "FORLOOP", "FORPREP"}
RK_OPS = {"GETTABLE", "SETTABLE", "SELF", "ADD", "SUB", "MUL", "DIV", "MOD", "POW", "EQ", "LT", "LE"}


@dataclass
class Header:
    endian: str
    int_size: int
    size_t_size: int
    instruction_size: int
    number_size: int
    integral: int


@dataclass
class Proto:
    source: str | None
    linedefined: int
    lastlinedefined: int
    nups: int
    numparams: int
    is_vararg: int
    maxstack: int
    code: list[int]
    constants: list[Any]
    protos: list["Proto"]
    lineinfo: list[int]
    locvars: list[tuple[str | None, int, int]]
    upvalues: list[str | None]


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.off = 0
        self.header: Header | None = None

    def take(self, n: int) -> bytes:
        end = self.off + n
        if end > len(self.data):
            raise ValueError(f"truncated chunk at offset {self.off}, need {n} bytes")
        out = self.data[self.off:end]
        self.off = end
        return out

    def byte(self) -> int:
        return self.take(1)[0]

    def uint(self, n: int) -> int:
        assert self.header is not None
        return int.from_bytes(self.take(n), "little" if self.header.endian == "<" else "big", signed=False)

    def lua_int(self) -> int:
        assert self.header is not None
        return self.uint(self.header.int_size)

    def size_t(self) -> int:
        assert self.header is not None
        return self.uint(self.header.size_t_size)

    def string(self) -> str | None:
        n = self.size_t()
        if n == 0:
            return None
        raw = self.take(n)
        if raw.endswith(b"\x00"):
            raw = raw[:-1]
        return raw.decode("utf-8", "backslashreplace")

    def number(self) -> Any:
        assert self.header is not None
        raw = self.take(self.header.number_size)
        if self.header.integral == 1:
            return int.from_bytes(raw, "little" if self.header.endian == "<" else "big", signed=True)
        if self.header.number_size == 8:
            return struct.unpack(self.header.endian + "d", raw)[0]
        if self.header.number_size == 4:
            return struct.unpack(self.header.endian + "f", raw)[0]
        return "0x" + raw.hex()


def parse_header(r: Reader) -> Header:
    if r.take(4) != b"\x1bLua":
        raise ValueError("not a Lua chunk")
    version = r.byte()
    fmt = r.byte()
    endian_flag = r.byte()
    int_size = r.byte()
    size_t_size = r.byte()
    instruction_size = r.byte()
    number_size = r.byte()
    integral = r.byte()
    if version != 0x51:
        raise ValueError(f"unsupported Lua version 0x{version:02x}")
    if fmt != 0:
        raise ValueError(f"unsupported Lua chunk format {fmt}")
    if endian_flag not in (0, 1):
        raise ValueError(f"invalid endian flag {endian_flag}")
    h = Header(
        endian="<" if endian_flag == 1 else ">",
        int_size=int_size,
        size_t_size=size_t_size,
        instruction_size=instruction_size,
        number_size=number_size,
        integral=integral,
    )
    r.header = h
    if instruction_size != 4:
        raise ValueError(f"unsupported instruction size {instruction_size}")
    return h


def parse_proto(r: Reader, parent_source: str | None = None) -> Proto:
    source = r.string() or parent_source
    linedefined = r.lua_int()
    lastlinedefined = r.lua_int()
    nups = r.byte()
    numparams = r.byte()
    is_vararg = r.byte()
    maxstack = r.byte()

    ncode = r.lua_int()
    code = [r.uint(r.header.instruction_size) for _ in range(ncode)]

    nk = r.lua_int()
    constants: list[Any] = []
    for _ in range(nk):
        tag = r.byte()
        if tag == 0:
            constants.append(None)
        elif tag == 1:
            constants.append(bool(r.byte()))
        elif tag == 3:
            constants.append(r.number())
        elif tag == 4:
            constants.append(r.string())
        elif tag == 9:
            # OpenWrt/LEDE Lua 5.1 carries the integer-optimization patch.
            # Its twelfth header byte is the lua_Integer width (4 on this
            # MIPS target), and integer constants use the private tag 9.
            width = r.header.integral if r.header.integral not in (0, 1) else r.header.int_size
            raw = r.take(width)
            constants.append(int.from_bytes(
                raw,
                "little" if r.header.endian == "<" else "big",
                signed=True,
            ))
        else:
            raise ValueError(f"unsupported constant tag {tag} at offset {r.off}")

    np = r.lua_int()
    protos = [parse_proto(r, source) for _ in range(np)]

    nline = r.lua_int()
    lineinfo = [r.lua_int() for _ in range(nline)]

    nloc = r.lua_int()
    locvars = [(r.string(), r.lua_int(), r.lua_int()) for _ in range(nloc)]

    nupnames = r.lua_int()
    upvalues = [r.string() for _ in range(nupnames)]

    return Proto(
        source, linedefined, lastlinedefined, nups, numparams, is_vararg,
        maxstack, code, constants, protos, lineinfo, locvars, upvalues,
    )


def kfmt(constants: list[Any], idx: int) -> str:
    if idx < 0 or idx >= len(constants):
        return f"K[{idx}]?"
    return f"K[{idx}]={constants[idx]!r}"


def rkfmt(constants: list[Any], x: int) -> str:
    if x >= 256:
        return kfmt(constants, x - 256)
    return f"R{x}"


def decode_instruction(word: int, constants: list[Any]) -> str:
    op = word & 0x3F
    a = (word >> 6) & 0xFF
    c = (word >> 14) & 0x1FF
    b = (word >> 23) & 0x1FF
    bx = (word >> 14) & 0x3FFFF
    sbx = bx - 131071
    name = OPNAMES[op] if op < len(OPNAMES) else f"OP_{op}"

    if name in ABX:
        extra = kfmt(constants, bx) if name in {"LOADK", "GETGLOBAL", "SETGLOBAL"} else f"P[{bx}]"
        return f"{name:<10} A={a:<3} Bx={bx:<6} ; {extra}"
    if name in ASBX:
        return f"{name:<10} A={a:<3} sBx={sbx:+d}"

    suffix = ""
    if name in RK_OPS:
        suffix = f" ; B={rkfmt(constants, b)} C={rkfmt(constants, c)}"
    elif name == "LOADBOOL":
        suffix = f" ; value={bool(b)} skip={bool(c)}"
    return f"{name:<10} A={a:<3} B={b:<3} C={c:<3}{suffix}"


def dump_proto(p: Proto, out, depth: int = 0, ordinal: str = "0") -> None:
    pad = "  " * depth
    print(f"{pad}PROTO {ordinal} source={p.source!r} lines={p.linedefined}-{p.lastlinedefined} "
          f"params={p.numparams} nups={p.nups} vararg={p.is_vararg} maxstack={p.maxstack}", file=out)
    print(f"{pad}CONSTANTS {len(p.constants)}", file=out)
    for i, value in enumerate(p.constants):
        print(f"{pad}  K[{i}] = {value!r}", file=out)
    print(f"{pad}CODE {len(p.code)}", file=out)
    for pc, word in enumerate(p.code, start=1):
        line = p.lineinfo[pc - 1] if pc - 1 < len(p.lineinfo) else 0
        print(f"{pad}  {pc:04d} line={line:<5} 0x{word:08x}  {decode_instruction(word, p.constants)}", file=out)
    if p.locvars:
        print(f"{pad}LOCALS {p.locvars!r}", file=out)
    if p.upvalues:
        print(f"{pad}UPVALUES {p.upvalues!r}", file=out)
    for i, child in enumerate(p.protos):
        dump_proto(child, out, depth + 1, f"{ordinal}.{i}")
    print(file=out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("chunk", type=Path)
    args = ap.parse_args()

    data = args.chunk.read_bytes()
    r = Reader(data)
    h = parse_header(r)
    print(
        f"HEADER endian={'little' if h.endian == '<' else 'big'} int={h.int_size} "
        f"size_t={h.size_t_size} instruction={h.instruction_size} "
        f"number={h.number_size} integral_or_integer_size={h.integral}"
    )
    p = parse_proto(r)
    dump_proto(p, out=__import__("sys").stdout)
    if r.off != len(data):
        print(f"TRAILING_BYTES={len(data) - r.off}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
