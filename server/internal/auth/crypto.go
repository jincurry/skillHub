package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

// deriveAESKey turns the platform's master secret (the JWT signing secret) into
// a 32-byte AES-256 key. The version suffix lets us rotate the derivation if
// we ever need to invalidate previously stored ciphertexts.
func deriveAESKey(masterSecret []byte) []byte {
	buf := make([]byte, 0, len(masterSecret)+16)
	buf = append(buf, masterSecret...)
	buf = append(buf, []byte(":ai-key-v1")...)
	h := sha256.Sum256(buf)
	return h[:]
}

// EncryptSecret seals plaintext with AES-256-GCM and returns base64(nonce || ct).
// Use it to put third-party API keys into the database without leaving them in
// the clear.
func EncryptSecret(masterSecret []byte, plaintext string) (string, error) {
	if len(masterSecret) == 0 {
		return "", errors.New("master secret is empty")
	}
	block, err := aes.NewCipher(deriveAESKey(masterSecret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// DecryptSecret reverses EncryptSecret. An empty input returns "" and no error
// so callers can treat "no key configured yet" as a normal state.
func DecryptSecret(masterSecret []byte, b64 string) (string, error) {
	if b64 == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(deriveAESKey(masterSecret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
