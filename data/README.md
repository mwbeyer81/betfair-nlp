# Source data provenance

Everything else under `data/` is gitignored (`.gitignore`, "Large data files"),
so this file is the only record of where the dataset came from. That record did
not exist before, which is exactly the problem it fixes: on 2026-08-14 the full
CSV was absent from every checkout on the VM and from git history, and nothing
in the repo said which Kaggle dataset to re-download.

## The dataset

| | |
|---|---|
| Source | https://www.kaggle.com/datasets/deltaromeo/horse-racing-results-ukireland-2015-2025 |
| Title | Horse Racing results — UK/Ireland 1988-2026 |
| Last updated | 3 June 2026 |
| Consumed by | `src/commands/import-industry-sp.ts` (`yarn import:industry-sp`) |

**The URL slug is stale and that is not a mistake.** Kaggle keeps the original
slug when an owner renames or extends a dataset, so `...-2015-2025` now serves
data titled 1988-2026. Corroboration that this is the right source: the local
`mini-update.csv` ends on 2026-06-03, matching the dataset's own last-updated
date exactly.

## Files

### `kaggle-horse-racing-uk-ireland/extracted/mini-update.csv`

The only file present in this checkout.

| | |
|---|---|
| Size | 1,333,089 bytes (344,753 gzipped) |
| Rows | 3,653 |
| Date range | 2026-05-28 → 2026-06-03 |
| sha256 | `1dce44dc468742c7205fbbc427ca30af0ab9caf4cf85af944800e5088350787c` |
| `comment` column | 79.7% populated |

Used as the fixture for the local CI-style E2E suite — `scripts/local-ci-e2e.sh`
imports the single day 2026-06-03 into a throwaway mongod.

### `kaggle-horse-racing-uk-ireland/extracted/form_2015-present/form_2015-present/raceform.csv`

**Not present.** This is `import-industry-sp.ts`'s default `SOURCE_CSV` and the
file the production collection was originally seeded from. Re-download it from
the dataset above; verify the archive's actual layout before assuming the
doubled `form_2015-present/form_2015-present/` nesting still holds, since
`SOURCE_CSV` is env-overridable if it differs.

Expected scale, extrapolated from `mini-update.csv` (365 bytes/row) and the
~1.85M-row figure in `import-industry-sp.ts`: **0.53–0.68 GB** raw, ~150 MB
gzipped.

```bash
pip install kaggle          # then place an API token at ~/.kaggle/kaggle.json
kaggle datasets download -d deltaromeo/horse-racing-results-ukireland-2015-2025 \
  -p data/kaggle-horse-racing-uk-ireland --unzip
```

## Archiving to S3

**Not done yet — blocked on IAM.** The intent is a private, versioned bucket
under our own control, because the dataset belongs to an individual Kaggle
account that can be made private or deleted without notice (and the owner
demonstrably mutates it — see the slug note above).

Not Git LFS: GitHub's free tier is 1 GB storage and 1 GB/month bandwidth, LFS
retains every version with no convenient prune, and the file would materialise
in every worktree on the machine. ~150 MB in S3 Standard costs about
$0.004/month.

`betfair-nlp-web` is **not** a fallback: `apps/web/deploy.sh` runs
`aws s3 sync dist/ --delete` against it, which would delete any foreign object
on the next web deploy.

The blocker, as of 2026-08-14: the AWS identity on this VM
(`arn:aws:iam::465137780330:user/lbs-dev`) has neither `s3:ListAllMyBuckets`
nor `s3:CreateBucket`. Once an identity with those permissions is available:

```bash
aws s3api create-bucket --bucket betfair-nlp-data --region eu-north-1 \
  --create-bucket-configuration LocationConstraint=eu-north-1
aws s3api put-public-access-block --bucket betfair-nlp-data \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket betfair-nlp-data \
  --versioning-configuration Status=Enabled

gzip -c data/kaggle-horse-racing-uk-ireland/extracted/mini-update.csv \
  | aws s3 cp - s3://betfair-nlp-data/kaggle/mini-update-2026-06-03.csv.gz

# And once raceform.csv has been downloaded:
gzip -c data/kaggle-horse-racing-uk-ireland/extracted/form_2015-present/form_2015-present/raceform.csv \
  | aws s3 cp - s3://betfair-nlp-data/kaggle/raceform-2026-06-03.csv.gz
```

Update the sha256 table above whenever a new copy is archived.

## Known gap in the seeded data

Production is missing **2026-05-28 → 2026-06-30** entirely (~1,000 races).
`import-industry-sp.ts` defaults `TO_DATE=2026-05-27`, so the CSV import stopped
there, and the RacingAPI results-capture cron did not start until July.

`mini-update.csv` covers the first week of that hole (2026-05-28 → 06-03) but
was only ever imported into the local CI fixture, never production. The rest,
2026-06-04 → 06-30, is not recoverable from this dataset at all — it ends on
06-03 — and would need RacingAPI historical results, which
`.claude/commands/industry-sp-results-cron.md` records as requiring a
Standard-tier upgrade the account does not have.

## Reseeding is destructive

`import-industry-sp.ts` upserts with `replaceOne` per race, replacing each
document wholesale. Every derived field is wiped and must be rebuilt:

```bash
yarn import:industry-sp
yarn precompute:trainer-form
yarn precompute:jockey-form
yarn precompute:horse-form
yarn precompute:distance-furlongs      # needed by the Distance filter
ml/venv/bin/python ml/train_and_predict.py
ml/venv/bin/python ml/walk_forward_score.py
```
