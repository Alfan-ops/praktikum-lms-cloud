# praktikum_streamlit.py
import streamlit as st
import pandas as pd
import matplotlib.pyplot as plt

st.set_page_config(page_title="Modul Streamlit - Iris Dataset", layout="centered")

st.title("🌸 Praktikum: Analisis Dataset Iris")
st.markdown("Modul ini merupakan contoh **praktikum berbasis Streamlit**.")

# 🔹 Load dataset sederhana
@st.cache_data
def load_data():
    url = "https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv"
    return pd.read_csv(url)

df = load_data()

# 🔹 Tampilkan data
st.subheader("📊 Data Awal")
st.dataframe(df.head())

# 🔹 Visualisasi sederhana
st.subheader("🌿 Visualisasi Data")
species = st.selectbox("Pilih jenis bunga:", df["species"].unique())

filtered = df[df["species"] == species]

fig, ax = plt.subplots()
ax.scatter(filtered["sepal_length"], filtered["sepal_width"], label="Sepal", color="teal")
ax.scatter(filtered["petal_length"], filtered["petal_width"], label="Petal", color="orange")
ax.set_xlabel("Length")
ax.set_ylabel("Width")
ax.legend()
st.pyplot(fig)

st.info("✅ Praktikum Streamlit berjalan dengan benar.")
