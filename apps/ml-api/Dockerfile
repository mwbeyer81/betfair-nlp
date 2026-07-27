# Container-image Lambda serving the win-probability model. Build context
# is the repo root (see build.sh) so this can pull ml/requirements.txt and
# ml/train_and_predict.py directly rather than duplicating them.
FROM public.ecr.aws/lambda/python:3.12

COPY ml/requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY ml/train_and_predict.py ${LAMBDA_TASK_ROOT}/train_and_predict.py
COPY apps/ml-api/handler.py ${LAMBDA_TASK_ROOT}/handler.py

# Baked in by build.sh right before `docker build` (fetched from S3 —
# see apps/ml-api/build.sh and ml/train_and_predict.py's
# upload_model_to_s3()). train_and_predict.py's MODEL_DIR resolves
# relative to itself, so this must sit at ${LAMBDA_TASK_ROOT}/models/,
# next to train_and_predict.py above.
COPY apps/ml-api/models/ ${LAMBDA_TASK_ROOT}/models/

CMD ["handler.handler"]
