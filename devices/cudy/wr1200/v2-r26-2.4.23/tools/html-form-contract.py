#!/usr/bin/env python3
"""Sanitize HTML form contracts for RouterLab evidence.

Print form actions, methods, field names/types and non-secret default values.
Values whose field names look credential/session-related are always redacted.
"""
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path

SECRET_FRAGMENTS = (
    "password", "passwd", "secret", "token", "csrf", "key", "pin",
)


def is_secret(name: str) -> bool:
    lowered = (name or "").lower()
    return any(fragment in lowered for fragment in SECRET_FRAGMENTS)


class ContractParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.forms: list[dict] = []
        self.current_form: dict | None = None
        self.current_select: dict | None = None

    @staticmethod
    def attrs_dict(attrs):
        return {str(k): ("" if v is None else str(v)) for k, v in attrs}

    def handle_starttag(self, tag, attrs):
        a = self.attrs_dict(attrs)
        tag = tag.lower()

        if tag == "form":
            form = {
                "action": a.get("action", ""),
                "method": a.get("method", "get").lower(),
                "fields": [],
            }
            self.forms.append(form)
            self.current_form = form
            return

        if not self.current_form:
            return

        if tag == "input":
            name = a.get("name", "")
            if not name:
                return
            value = a.get("value", "")
            self.current_form["fields"].append({
                "kind": "input",
                "name": name,
                "type": a.get("type", "text").lower(),
                "value": "<redacted>" if is_secret(name) else value,
                "checked": "checked" in a,
            })
            return

        if tag == "select":
            name = a.get("name", "")
            if not name:
                return
            field = {"kind": "select", "name": name, "options": []}
            self.current_form["fields"].append(field)
            self.current_select = field
            return

        if tag == "option" and self.current_select is not None:
            value = a.get("value", "")
            self.current_select["options"].append({
                "value": "<redacted>" if is_secret(self.current_select["name"]) else value,
                "selected": "selected" in a,
            })

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == "select":
            self.current_select = None
        elif tag == "form":
            self.current_form = None
            self.current_select = None


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {Path(sys.argv[0]).name} HTML_FILE", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    parser = ContractParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))

    print(f"file={path.name}")
    print(f"forms={len(parser.forms)}")
    for idx, form in enumerate(parser.forms, 1):
        print(f"FORM {idx} method={form['method']} action={form['action']}")
        for field in form["fields"]:
            if field["kind"] == "input":
                extra = " checked=yes" if field["checked"] else ""
                print(
                    f"  INPUT name={field['name']} type={field['type']} "
                    f"value={field['value']}{extra}"
                )
            else:
                opts = ",".join(
                    f"{o['value']}{'*' if o['selected'] else ''}"
                    for o in field["options"]
                )
                print(f"  SELECT name={field['name']} options=[{opts}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
