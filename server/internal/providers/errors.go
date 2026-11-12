package providers

import (
	"errors"
	"fmt"
	"time"
)

var (
	ErrUncertain = errors.New("provider submission outcome is unknown")
	ErrQuota     = errors.New("provider quota or submission budget exhausted")
	// ErrRejected means the provider refused the request itself (content
	// policy, invalid parameters). Retrying the same request will not help.
	ErrRejected = errors.New("provider rejected the request")
	// ErrUnauthorized means the credentials are missing or invalid.
	ErrUnauthorized = errors.New("provider credentials were rejected")
)

// RateLimitedError means the provider asked us to slow down. The request was
// not accepted and can be sent again after RetryAfter (0 if unknown).
type RateLimitedError struct {
	RetryAfter time.Duration
}

func (e *RateLimitedError) Error() string {
	return fmt.Sprintf("provider rate limit, retry after %s", e.RetryAfter)
}
