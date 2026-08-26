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
		args     []any
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

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			actual := &bytes.Buffer{}
			cW(actual, c.useColor, c.color, c.s, c.args...)

			if got := actual.String(); got != c.expected {
				t.Errorf("output: %q, expected: %q", got, c.expected)
			}
		})
	}
}
