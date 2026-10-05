#!/usr/bin/env bash
# Đẩy repo này lên GitHub. Chạy: bash push-len-github.sh <tên-github> <tên-repo>
set -e
USER="${1:?Thiếu tên tài khoản GitHub}"
REPO="${2:-sotay-banhang}"
git init -b main 2>/dev/null || true
git add -A
git commit -m "Sổ tay bán hàng tạp hoá — bản đầu" || true
echo ""
echo "Bây giờ vào https://github.com/new tạo repo tên '$REPO' (để trống, đừng thêm README), rồi Enter."
read -r _
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$USER/$REPO.git"
git push -u origin main
echo ""
echo "✔ Xong. Vào https://github.com/$USER/$REPO/actions để tải APK sau khi build xong (~5 phút)."
