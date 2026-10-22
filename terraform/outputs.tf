output "frontend_bucket_name" {
  value = aws_s3_bucket.frontend.id
}

output "cloudfront_url" {
  value = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend.id
}

output "api_url" {
  value = aws_apigatewayv2_api.main.api_endpoint
}

output "notes_table_name" {
  value = aws_dynamodb_table.notes.name
}
