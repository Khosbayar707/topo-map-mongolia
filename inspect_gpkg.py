import sqlite3
conn = sqlite3.connect(r'E:\0. 2026\БУСАД\coding\Topo_map\map\mongolia.gpkg')
cur = conn.cursor()
cur.execute('SELECT table_name, data_type FROM gpkg_contents')
rows = cur.fetchall()
for r in rows:
    cur2 = conn.cursor()
    try:
        cur2.execute(f'SELECT COUNT(*) FROM "{r[0]}"')
        cnt = cur2.fetchone()[0]
    except:
        cnt = '?'
    print(f'{r[0]} | {r[1]} | {cnt} features')
conn.close()
