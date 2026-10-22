variable "project_name" {
  type    = string
  default = "understanding-note"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "aws_region" {
  type    = string
  default = "ap-northeast-1"
}

variable "bedrock_model_id" {
  type    = string
  default = "jp.amazon.nova-2-lite-v1:0"
}


variable "budget_email" {
  type = string
}

variable "monthly_budget_usd" {
  type    = number
  default = 5
}
