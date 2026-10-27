package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var fileID = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,80}$`)

func (s *Server) objectClient(r *http.Request) (*s3.Client, error) {
	region := os.Getenv("S3_REGION")
	if region == "" {
		region = "auto"
	}
	cfg, err := config.LoadDefaultConfig(r.Context(), config.WithRegion(region), config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(os.Getenv("S3_ACCESS_KEY"), os.Getenv("S3_SECRET_KEY"), "")))
	if err != nil {
		return nil, err
	}
	return s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
		o.BaseEndpoint = aws.String(os.Getenv("S3_ENDPOINT"))
	}), nil
}
func filePath(key string) string {
	root := os.Getenv("FILE_DIR")
	if root == "" {
		root = "./data/files"
	}
	return filepath.Join(root, key)
}
func (s *Server) putFile(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	typ := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if !fileID.MatchString(id) || (typ != "image/jpeg" && typ != "image/png" && typ != "image/webp" && typ != "image/heic") {
		return bad
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 10*1024*1024+1))
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return bad
	}
	if len(data) > 10*1024*1024 {
		return apiError{413, "too_large", "파일이 너무 커요(최대 10MB)"}
	}
	key := fmtKey(user, id)
	sum := sha256.Sum256(data)
	sha := hex.EncodeToString(sum[:])
	bucket := os.Getenv("S3_BUCKET")
	if bucket != "" {
		client, e := s.objectClient(r)
		if e != nil {
			return e
		}
		_, err = client.PutObject(r.Context(), &s3.PutObjectInput{Bucket: aws.String(bucket), Key: aws.String(key), Body: bytes.NewReader(data)})
	} else {
		path := filePath(key)
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return err
		}
		var tmp *os.File
		tmp, err = os.CreateTemp(filepath.Dir(path), ".up-*")
		if err != nil {
			return err
		}
		defer os.Remove(tmp.Name())
		if _, err = tmp.Write(data); err != nil {
			tmp.Close()
			return err
		}
		if err = tmp.Close(); err != nil {
			return err
		}
		err = os.Rename(tmp.Name(), path)
	}
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(r.Context(), `INSERT INTO files(user_id,id,content_type,size_bytes,sha256,storage_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,id) DO UPDATE SET content_type=EXCLUDED.content_type,size_bytes=EXCLUDED.size_bytes,sha256=EXCLUDED.sha256,storage_key=EXCLUDED.storage_key`, user, id, typ, len(data), sha, key)
	if err != nil {
		return err
	}
	w.WriteHeader(204)
	return nil
}
func (s *Server) getFile(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	var typ, key, sha string
	err = s.DB.QueryRow(r.Context(), "SELECT content_type,storage_key,sha256 FROM files WHERE user_id=$1 AND id=$2", user, r.PathValue("id")).Scan(&typ, &key, &sha)
	if err != nil {
		return err
	}
	var body io.ReadCloser
	if bucket := os.Getenv("S3_BUCKET"); bucket != "" {
		client, e := s.objectClient(r)
		if e != nil {
			return e
		}
		res, e := client.GetObject(r.Context(), &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
		if e != nil {
			return e
		}
		body = res.Body
	} else {
		body, err = os.Open(filePath(key))
		if err != nil {
			return err
		}
	}
	defer body.Close()
	w.Header().Set("Content-Type", typ)
	w.Header().Set("ETag", "\""+sha+"\"")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	_, err = io.Copy(w, body)
	return err
}

func fmtKey(user int64, id string) string { return strconv.FormatInt(user, 10) + "/" + id }
