#!/usr/bin/env python3
"""
Check users in the database - displays user info without passwords
"""
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database connection
try:
    conn = psycopg2.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        port=os.getenv('DB_PORT', '5432'),
        database=os.getenv('DB_NAME', 'smartattend'),
        user=os.getenv('DB_USER', 'smartattend_user'),
        password=os.getenv('DB_PASSWORD', 'smartattend_password')
    )
    
    print("✅ Connected to database\n")
    
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Get all users
        cur.execute("""
            SELECT 
                id,
                email,
                full_name,
                role,
                platform,
                is_active,
                created_at,
                last_login
            FROM users
            ORDER BY created_at DESC
        """)
        
        users = cur.fetchall()
        print(f"📊 Total Users: {len(users)}\n")
        print("=" * 120)
        
        if users:
            print(f"{'Email':<40} {'Name':<25} {'Role':<15} {'Platform':<15} {'Active':<8} {'Last Login':<20}")
            print("=" * 120)
            
            for user in users:
                email = user['email'][:40]
                name = (user['full_name'] or 'N/A')[:25]
                role = user['role'][:15]
                platform = user['platform'][:15] if user['platform'] else 'N/A'
                active = '✅' if user['is_active'] else '❌'
                last_login = str(user['last_login'])[:20] if user['last_login'] else 'Never'
                
                print(f"{email:<40} {name:<25} {role:<15} {platform:<15} {active:<8} {last_login:<20}")
            
            print("=" * 120)
            print("\n📋 User Details by Platform:")
            print("-" * 120)
            
            # Group by platform
            platforms = {}
            for user in users:
                platform = user['platform'] or 'General'
                if platform not in platforms:
                    platforms[platform] = []
                platforms[platform].append(user)
            
            for platform, platform_users in sorted(platforms.items()):
                print(f"\n🏢 {platform.upper()} ({len(platform_users)} users)")
                for user in platform_users:
                    print(f"  - {user['email']:<35} ({user['role']}) - {'Active' if user['is_active'] else 'Inactive'}")
        else:
            print("❌ No users found in database")
    
    conn.close()
    print("\n✅ Done")
    
except psycopg2.Error as e:
    print(f"❌ Database error: {e}")
except Exception as e:
    print(f"❌ Error: {e}")
