// Package apperr defines errors shared across packages. The HTTP layer maps
// them to status codes; producers never need to know about HTTP.
package apperr

import "errors"

var ErrNotFound = errors.New("not found")

// ValidationError reports invalid caller input. Message is safe to show to clients.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

// ConflictError reports a request that contradicts existing state.
// Code and Message are safe to show to clients.
type ConflictError struct{ Code, Message string }

func (e *ConflictError) Error() string { return e.Message }
