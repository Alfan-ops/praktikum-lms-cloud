# Hapus semua container hasil load test (nama diawali "praktikum_loadtest-")
# Jalankan setelah selesai tes Opsi A agar laptop tidak penuh container.

Write-Host "Mencari container load test..." -ForegroundColor Cyan
$containers = docker ps -a --filter "name=praktikum_loadtest-" --format "{{.Names}}"

if (-not $containers) {
    Write-Host "Tidak ada container load test yang ditemukan. Bersih." -ForegroundColor Green
    exit 0
}

$count = ($containers | Measure-Object).Count
Write-Host "Ditemukan $count container. Menghentikan & menghapus..." -ForegroundColor Yellow

foreach ($c in $containers) {
    docker rm -f $c | Out-Null
    Write-Host "  dihapus: $c"
}

Write-Host "Selesai. $count container dihapus." -ForegroundColor Green
