data "aws_caller_identity" "current" {}

locals {
  resource_prefix = "${var.project_name}-${var.environment}"

  lambda_name = "${local.resource_prefix}-api"
  table_name  = "${local.resource_prefix}-notes"
  bucket_name = "${local.resource_prefix}-${data.aws_caller_identity.current.account_id}"
}
