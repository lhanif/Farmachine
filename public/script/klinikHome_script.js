// Fungsi untuk menambah obat ke daftar
function tambahObat() {
    const namaObat = document.getElementById('namaObat').value;
    const rep = document.getElementById('rep').value;
    const dose = document.getElementById('dose').value;
    const keterangan = document.getElementById('keterangan').value;

    // Validasi input obat
    if (namaObat && rep && dose) {
        const daftarObat = document.getElementById('daftarObat');
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${namaObat} - ${rep} x ${dose}</span>
            <button class="btn-delete" onclick="hapusObat(this)">Hapus</button>
        `;
        daftarObat.appendChild(li);

        // Reset form field setelah menambah obat
        document.getElementById('namaObat').value = '';
        document.getElementById('rep').value = '';
        document.getElementById('dose').value = '';
    } else {
        alert('Mohon isi semua field obat');
    }
}

// Fungsi untuk menghapus obat dari daftar
function hapusObat(button) {
    const li = button.parentElement;
    li.remove();
}

// Fungsi untuk menyimpan daftar obat ke database
async function simpanObat() {
    // Ambil data obat dari daftar
    const obatItems = document.querySelectorAll('#daftarObat li span');
    const obatData = Array.from(obatItems).map(item => {
        const [namaObat, repDose] = item.textContent.split(" - ");
        const [rep, dose] = repDose.split(" x ");
        return { nama_obat: namaObat.trim(), jumlah: parseInt(rep), dosis: dose.trim() };
    });

    // Ambil data pasien yang sudah diisi dari hasil pencarian NIK
    const nik = document.getElementById('nik').value;
    const nama_pasien = document.getElementById('nama').textContent;
    const no_rm = document.getElementById('rm').textContent;
    const umur = parseInt(document.getElementById('umur').textContent);
    const jenis_kelamin = document.getElementById('jenisKelamin').textContent;
    const keterangan = document.getElementById('keterangan').value; // Ambil nilai dari input keterangan

    // Validasi bahwa data pasien dan obat tersedia sebelum mengirim
    if (!nik || !nama_pasien || !no_rm || !umur || !jenis_kelamin || obatData.length === 0) {
        alert('Pastikan semua data pasien dan daftar obat sudah lengkap');
        return;
    }

    // Buat objek data untuk dikirim ke server
    const data = {
        nik,
        nama_pasien,
        no_rm,
        umur,
        jenis_kelamin,
        keterangan,
        obat: obatData
    };

    try {
        // Kirim data ke server
        const response = await fetch('http://localhost:5005/api/addPesanan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            alert('Pesanan berhasil disimpan');
            document.getElementById('daftarObat').innerHTML = ''; // Kosongkan daftar obat di UI
        } else {
            alert('Gagal menyimpan pesanan');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Terjadi kesalahan saat menyimpan pesanan');
    }
}

// Fungsi untuk mencari data pasien berdasarkan NIK
async function cariPasien() {
    const nik = document.getElementById('nik').value;
    
    if (!nik) {
        alert('Masukkan NIK terlebih dahulu');
        return;
    }

    try {
        const response = await fetch(`http://localhost:5005/api/patient?nik=${nik}`);
        
        if (response.ok) {
            const data = await response.json();
            
            // Menampilkan data pasien di halaman
            document.getElementById('nama').textContent = data.full_name;
            document.getElementById('rm').textContent = data.medical_record_number;
            document.getElementById('umur').textContent = data.age;
            document.getElementById('jenisKelamin').textContent = data.gender;
        } else {
            alert('Data pasien tidak ditemukan');
            // Reset data pasien jika tidak ditemukan
            document.getElementById('nama').textContent = '';
            document.getElementById('rm').textContent = '';
            document.getElementById('umur').textContent = '';
            document.getElementById('jenisKelamin').textContent = '';
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Gagal mengambil data pasien');
    }
}
