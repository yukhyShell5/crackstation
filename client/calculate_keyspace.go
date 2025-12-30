package main

import (
	"fmt"
	"strings"
)

const charset = "abcdefghijklmnopqrstuvwxyz0123456789"

func main() {
	target := "bonjour"
	// Also "abcde" for verification (expects ~60M if full 5 chars?)
	// "abcde" -> 1679616 + ...

	fmt.Printf("Calculating index for '%s'...\n", target)
	idx := stringToIndex(target)
	fmt.Printf("Index: %d\n", idx)

	// Verify reverse
	rev := indexToBytes(int(idx))
	fmt.Printf("Reverse verification: %s\n", string(rev))
}

func stringToIndex(s string) int64 {
	var n int64 = -1
	// Iterate Left to Right?
	// "aa" -> 36.
	// "a" -> 0.
	// Rightmost char 'a' in "aa" corresponds to... wait.
	// In "aa":
	// Loop 1 (generates right 'a'): n reduced to 0. Remainder 0.
	// Loop 2 (generates left 'a'): n starts at 36. Remainder 0. n becomes 0.

	// So if we rebuild from Left to Right:
	// We are reversing the "division".
	// n = (n_prev + 1) * 36 + charIndex

	for _, r := range s {
		charIdx := int64(strings.IndexRune(charset, r))
		// This effectively un-does the "n = n/36 - 1" step, combined with n%36
		n = (n+1)*int64(len(charset)) + charIdx
	}
	return n
}

func indexToBytes(n int) []byte {
	if n == 0 {
		return []byte{charset[0]}
	}
	charsetLen := len(charset)

	var s []byte
	for {
		r := n % charsetLen
		s = append([]byte{charset[r]}, s...)
		n = n/charsetLen - 1
		if n < 0 {
			break
		}
	}
	return s
}
