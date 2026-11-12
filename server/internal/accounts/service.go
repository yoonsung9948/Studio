package accounts

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"nori/studio/server/internal/platform/apperr"
)

var ErrDisabled = errors.New("account disabled")

type User struct {
	ID          string    `json:"id"`
	DisplayName string    `json:"displayName"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Identity must come from verified authentication claims.
type Identity struct {
	Issuer      string
	Subject     string
	DisplayName string
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Resolve creates an account once, without overwriting an existing profile.
func (s *Service) Resolve(ctx context.Context, identity Identity) (User, error) {
	if strings.TrimSpace(identity.Issuer) == "" || strings.TrimSpace(identity.Subject) == "" {
		return User{}, &apperr.ValidationError{Message: "identity issuer and subject are required"}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)
	// Serialize first requests for this identity across all server processes.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, fmt.Sprintf("account:%d:%s%s", len(identity.Issuer), identity.Issuer, identity.Subject)); err != nil {
		return User{}, err
	}
	user, err := scanUser(tx.QueryRow(ctx, `SELECT u.id::text,u.display_name,u.status,u.created_at,u.updated_at
        FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE i.issuer=$1 AND i.subject=$2`, identity.Issuer, identity.Subject))
	if errors.Is(err, pgx.ErrNoRows) {
		user, err = scanUser(tx.QueryRow(ctx, `INSERT INTO users(id,display_name) VALUES($1,$2)
            RETURNING id::text,display_name,status,created_at,updated_at`, uuid.NewString(), identity.DisplayName))
		if err != nil {
			return User{}, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO auth_identities(id,user_id,issuer,subject) VALUES($1,$2,$3,$4)`, uuid.NewString(), user.ID, identity.Issuer, identity.Subject); err != nil {
			return User{}, err
		}
	}
	if err != nil {
		return User{}, err
	}
	if user.Status != "active" {
		return User{}, ErrDisabled
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}
	return user, nil
}

func scanUser(row pgx.Row) (User, error) {
	var user User
	err := row.Scan(&user.ID, &user.DisplayName, &user.Status, &user.CreatedAt, &user.UpdatedAt)
	return user, err
}

type userKey struct{}

func WithUser(ctx context.Context, user User) context.Context {
	return context.WithValue(ctx, userKey{}, user)
}

func UserFromContext(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(userKey{}).(User)
	return user, ok
}

type identityKey struct{}

// WithIdentity is for authentication adapters after verifying credentials.
func WithIdentity(ctx context.Context, identity Identity) context.Context {
	return context.WithValue(ctx, identityKey{}, identity)
}
func IdentityFromContext(ctx context.Context) (Identity, bool) {
	identity, ok := ctx.Value(identityKey{}).(Identity)
	return identity, ok
}
