#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys, json

def u16(p, i):
    return int(p[i:i+4], 16)

def main():
    if len(sys.argv) < 2:
        print("Uso: python decode_new_v3.py <payload_hex>")
        sys.exit(1)

    p = sys.argv[1].strip().replace(" ", "").replace("\n", "").lower()

    if len(p) != 32:
        raise ValueError(f"Longitud inválida (esperado 32 hex dígitos, got {len(p)}).")

    data = {
        "avgT" : u16(p, 0)  / 100.0,
        "medT" : u16(p, 4)  / 100.0,
        "maxT" : u16(p, 8) / 100.0,
        "minT" : u16(p, 12) / 100.0,
        "avgH" : u16(p, 16) / 100.0,
        "medH" : u16(p, 20) / 100.0,
        "maxH" : u16(p, 24) / 100.0,
        "minH" : u16(p, 28) / 100.0  # Último campo
    }

    print(json.dumps(data, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
