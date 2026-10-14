// Vector helpers without Node dependencies (used by the build, the server and the static app).
export const toBlob = (v              ) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
export const fromBlob = (b            ) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
