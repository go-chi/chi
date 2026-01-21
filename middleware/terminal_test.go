package middleware

import (
	"bytes"
	"testing"
)

func Test_cW(t *testing.T) {
	cases := []struct {
		name     string
		useColor bool
		color    []byte
		s        string
		args     []interface{}
		expected string
	}{
		{
			name:     "No color",
			useColor: false,
			color:    nGreen,
			s:        "no color test",
			expected: "no color test",
		},
	}

	for name, c := range cases {
		actual := &bytes.Buffer{}
		cW(actual, c.useColor, c.color, c.s, c.args...)

		if actual.String() != c.expected {
			t.Errorf("(case %q) unexpected output: got %q, expected: %q", name, actual.String(), c.expected)
		}
	}
}
