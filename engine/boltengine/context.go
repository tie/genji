package boltengine

import (
	"context"
)

type contextKey string

const (
	fillPercentKey contextKey = "fill_percent"
)

func FillPercentContext(ctx context.Context, p float64) context.Context {
	return context.WithValue(ctx, fillPercentKey, p)
}

func fillPercent(ctx context.Context) (float64, bool) {
	v, ok := ctx.Value(fillPercentKey).(float64)
	return v, ok
}
