package middleware

import (
	"bytes"
	"log"
	"time"
)

// Logger is a middleware that logs the start and end of each request, along
// with some useful data about what was requested, what the response status was,
// and how long it took to return. When standard output is a TTY, Logger will
// print in color, otherwise it will print in black and white.
//
// Logger prints a request ID if one is provided.
var Logger = Metrics(logMetricsHandler{})

type logMetricsHandler struct{}

func (l logMetricsHandler) Add(m Metric) {

	buf := &bytes.Buffer{}

	if m.RequestID != "" {
		cW(buf, nYellow, "[%s] ", m.RequestID)
	}
	cW(buf, nCyan, "\"")
	cW(buf, bMagenta, "%s ", m.Method)
	cW(buf, nCyan, "%s\" ", m.URL)

	buf.WriteString("from ")
	buf.WriteString(m.RemoteAddr)
	buf.WriteString(" - ")

	status := m.Status
	if status == StatusClientClosedRequest {
		cW(buf, bRed, "[disconnected]")
	} else {
		switch {
		case status < 200:
			cW(buf, bBlue, "%03d", status)
		case status < 300:
			cW(buf, bGreen, "%03d", status)
		case status < 400:
			cW(buf, bCyan, "%03d", status)
		case status < 500:
			cW(buf, bYellow, "%03d", status)
		default:
			cW(buf, bRed, "%03d", status)
		}
	}

	cW(buf, bBlue, " %dB", m.BytesWritten)

	buf.WriteString(" in ")
	if m.ExecutionTime < 500*time.Millisecond {
		cW(buf, nGreen, "%s", m.ExecutionTime)
	} else if m.ExecutionTime < 5*time.Second {
		cW(buf, nYellow, "%s", m.ExecutionTime)
	} else {
		cW(buf, nRed, "%s", m.ExecutionTime)
	}

	log.Print(buf.String())
}
