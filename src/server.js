require('dotenv').config();
const app = require('./app');

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`API del Tablero de Control escuchando en el puerto ${port}`);
});
