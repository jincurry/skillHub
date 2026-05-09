package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// HashPassword returns a bcrypt hash for the given plaintext password.
func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// VerifyPassword reports whether the plaintext matches the stored bcrypt hash.
func VerifyPassword(stored, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(stored), []byte(pw)) == nil
}

// --- minimal HMAC-SHA256 JWT (no third-party dep) ---

type Claims struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
	Iat int64  `json:"iat"`
}

var b64 = base64.RawURLEncoding

func encodeSegment(v any) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return b64.EncodeToString(b), nil
}

// SignJWT issues a token for `sub`, valid for `ttl`.
func SignJWT(sub string, secret []byte, ttl time.Duration) (string, error) {
	now := time.Now().Unix()
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	claims := Claims{Sub: sub, Iat: now, Exp: now + int64(ttl.Seconds())}

	hSeg, err := encodeSegment(header)
	if err != nil {
		return "", err
	}
	cSeg, err := encodeSegment(claims)
	if err != nil {
		return "", err
	}
	signing := hSeg + "." + cSeg
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signing))
	sig := b64.EncodeToString(mac.Sum(nil))
	return signing + "." + sig, nil
}

// ParseJWT validates the token and returns the subject (username).
func ParseJWT(token string, secret []byte) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("invalid token format")
	}
	signing := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signing))
	expected := b64.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return "", errors.New("invalid signature")
	}
	payload, err := b64.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", err
	}
	if claims.Exp > 0 && time.Now().Unix() > claims.Exp {
		return "", errors.New("token expired")
	}
	if claims.Sub == "" {
		return "", errors.New("missing subject")
	}
	return claims.Sub, nil
}
