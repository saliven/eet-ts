import forge from "node-forge";

const textEncoder = new TextEncoder();

export function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(value);
}

export function bytesToBinary(bytes: Uint8Array): string {
  return forge.util.binary.raw.encode(bytes);
}

export function binaryToBytes(binary: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(forge.util.binary.raw.decode(binary));
}

export function bytesToBase64(bytes: Uint8Array): string {
  return forge.util.encode64(bytesToBinary(bytes));
}
